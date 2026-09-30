//! The `notes` table: one row per markdown file.

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::records::{NoteMeta, NoteRecord, NoteRow};
use crate::Result;

/// Insert or update the note at `note.path` and return its id. The id is
/// stable across updates, so rows in the child tables keep pointing at it.
pub fn upsert(conn: &Connection, note: &NoteRecord) -> Result<i64> {
    let id = conn
        .prepare_cached(
            "INSERT INTO notes (path, title, hash, mtime, size, frontmatter, indexed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT (path) DO UPDATE SET
                 title = excluded.title,
                 hash = excluded.hash,
                 mtime = excluded.mtime,
                 size = excluded.size,
                 frontmatter = excluded.frontmatter,
                 indexed_at = excluded.indexed_at
             RETURNING id",
        )?
        .query_row(
            params![
                note.path,
                note.title,
                note.hash,
                note.mtime,
                i64::try_from(note.size).unwrap_or(i64::MAX),
                note.frontmatter,
                now_ms()
            ],
            |row| row.get(0),
        )?;
    Ok(id)
}

pub fn get_by_path(conn: &Connection, path: &str) -> Result<Option<NoteRow>> {
    Ok(conn
        .prepare_cached(
            "SELECT id, path, title, hash, mtime, size, frontmatter, indexed_at
             FROM notes WHERE path = ?1",
        )?
        .query_row([path], note_row)
        .optional()?)
}

pub fn id_for_path(conn: &Connection, path: &str) -> Result<Option<i64>> {
    Ok(conn
        .prepare_cached("SELECT id FROM notes WHERE path = ?1")?
        .query_row([path], |row| row.get(0))
        .optional()?)
}

/// Delete one note (its links, tags, headings and tasks go with it).
/// Returns whether a row existed.
pub fn delete_by_path(conn: &Connection, path: &str) -> Result<bool> {
    let n = conn
        .prepare_cached("DELETE FROM notes WHERE path = ?1")?
        .execute([path])?;
    Ok(n > 0)
}

/// Delete every note inside `folder` (recursively). Returns how many.
pub fn delete_prefix(conn: &Connection, folder: &str) -> Result<usize> {
    let n = conn
        .prepare_cached(&format!("DELETE FROM notes WHERE {IN_FOLDER}"))?
        .execute([folder.trim_end_matches('/')])?;
    Ok(n)
}

/// Delete every note. Used before a full reindex.
pub fn delete_all(conn: &Connection) -> Result<usize> {
    Ok(conn.execute("DELETE FROM notes", [])?)
}

/// Move one note to a new path. Returns whether a row existed.
pub fn rename_path(conn: &Connection, old: &str, new: &str) -> Result<bool> {
    let n = conn
        .prepare_cached("UPDATE notes SET path = ?2 WHERE path = ?1")?
        .execute([old, new])?;
    Ok(n > 0)
}

/// Move every note under folder `old` to the same place under `new`
/// (`old/a/b.md` becomes `new/a/b.md`). Returns how many moved.
pub fn rename_prefix(conn: &Connection, old: &str, new: &str) -> Result<usize> {
    let n = conn
        .prepare_cached(&format!(
            "UPDATE notes SET path = ?2 || substr(path, length(?1) + 1) WHERE {IN_FOLDER}"
        ))?
        .execute([old.trim_end_matches('/'), new.trim_end_matches('/')])?;
    Ok(n)
}

/// Path, title, mtime and hash of every note, ordered by path.
pub fn list_all_meta(conn: &Connection) -> Result<Vec<NoteMeta>> {
    let mut stmt =
        conn.prepare_cached("SELECT path, title, mtime, hash FROM notes ORDER BY path")?;
    let rows = stmt.query_map([], |row| {
        Ok(NoteMeta {
            path: row.get(0)?,
            title: row.get(1)?,
            mtime: row.get(2)?,
            hash: row.get(3)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn count(conn: &Connection) -> Result<u32> {
    Ok(conn
        .prepare_cached("SELECT count(*) FROM notes")?
        .query_row([], |row| row.get(0))?)
}

/// Matches rows whose `path` is inside the folder bound as `?1` (no trailing
/// slash). Written with `substr` rather than `LIKE` so `%` and `_` in folder
/// names need no escaping.
pub(crate) const IN_FOLDER: &str = "substr(path, 1, length(?1) + 1) = ?1 || '/'";

fn note_row(row: &Row<'_>) -> rusqlite::Result<NoteRow> {
    Ok(NoteRow {
        id: row.get(0)?,
        path: row.get(1)?,
        title: row.get(2)?,
        hash: row.get(3)?,
        mtime: row.get(4)?,
        size: row
            .get::<_, Option<i64>>(5)?
            .map(|n| u64::try_from(n).unwrap_or(0)),
        frontmatter: row.get(6)?,
        indexed_at: row.get(7)?,
    })
}

fn now_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0.0, |d| d.as_secs_f64() * 1000.0)
}
