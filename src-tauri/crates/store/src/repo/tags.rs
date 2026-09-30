//! The `tags` table: `#tags` and frontmatter tags per note, without the `#`.

use rusqlite::Connection;

use crate::records::TagCount;
use crate::Result;

/// Replace the tags of `note_id`. Duplicates are ignored.
pub fn replace_for_note(conn: &Connection, note_id: i64, tags: &[String]) -> Result<()> {
    conn.prepare_cached("DELETE FROM tags WHERE note_id = ?1")?
        .execute([note_id])?;
    let mut insert =
        conn.prepare_cached("INSERT OR IGNORE INTO tags (note_id, tag) VALUES (?1, ?2)")?;
    for tag in tags {
        insert.execute(rusqlite::params![note_id, tag])?;
    }
    Ok(())
}

/// Tags of one note, sorted.
pub fn list_for_note(conn: &Connection, note_id: i64) -> Result<Vec<String>> {
    let mut stmt = conn.prepare_cached("SELECT tag FROM tags WHERE note_id = ?1 ORDER BY tag")?;
    let rows = stmt.query_map([note_id], |row| row.get(0))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Every tag in the vault with its note count, sorted by tag.
pub fn all_with_counts(conn: &Connection) -> Result<Vec<TagCount>> {
    let mut stmt =
        conn.prepare_cached("SELECT tag, count(*) FROM tags GROUP BY tag ORDER BY tag")?;
    let rows = stmt.query_map([], |row| {
        Ok(TagCount {
            tag: row.get(0)?,
            count: row.get(1)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Paths of the notes tagged `tag`, sorted.
pub fn notes_with_tag(conn: &Connection, tag: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare_cached(
        "SELECT n.path FROM tags t JOIN notes n ON n.id = t.note_id
         WHERE t.tag = ?1 ORDER BY n.path",
    )?;
    let rows = stmt.query_map([tag], |row| row.get(0))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}
