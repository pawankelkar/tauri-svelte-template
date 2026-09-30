//! The `links` table: outgoing links per note, resolved or not.
//!
//! `target_raw` is matched case-insensitively (ASCII), like Obsidian's
//! basename resolution.

use rusqlite::{params, Connection};

use crate::records::{BacklinkRow, LinkRecord, LinkTargetRow, UnresolvedLink};
use crate::Result;

/// Replace every outgoing link of `note_id` with `links`.
pub fn replace_for_note(conn: &Connection, note_id: i64, links: &[LinkRecord]) -> Result<()> {
    conn.prepare_cached("DELETE FROM links WHERE source_id = ?1")?
        .execute([note_id])?;
    let mut insert = conn.prepare_cached(
        "INSERT INTO links
             (source_id, target_raw, target_path, heading, alias, is_embed, line, context)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    )?;
    for link in links {
        insert.execute(params![
            note_id,
            link.target_raw,
            link.target_path,
            link.heading,
            link.alias,
            link.is_embed,
            link.line,
            link.context,
        ])?;
    }
    Ok(())
}

/// Outgoing links of one note, in line order.
pub fn list_for_note(conn: &Connection, note_id: i64) -> Result<Vec<LinkRecord>> {
    let mut stmt = conn.prepare_cached(
        "SELECT target_raw, target_path, heading, alias, is_embed, line, context
         FROM links WHERE source_id = ?1 ORDER BY line, rowid",
    )?;
    let rows = stmt.query_map([note_id], |row| {
        Ok(LinkRecord {
            target_raw: row.get(0)?,
            target_path: row.get(1)?,
            heading: row.get(2)?,
            alias: row.get(3)?,
            is_embed: row.get(4)?,
            line: row.get(5)?,
            context: row.get(6)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Every link that resolved to `target_path`, ordered by source path then
/// line.
pub fn backlinks(conn: &Connection, target_path: &str) -> Result<Vec<BacklinkRow>> {
    let mut stmt = conn.prepare_cached(
        "SELECT n.path, n.title, l.line, l.context
         FROM links l JOIN notes n ON n.id = l.source_id
         WHERE l.target_path = ?1
         ORDER BY n.path, l.line",
    )?;
    let rows = stmt.query_map([target_path], |row| {
        Ok(BacklinkRow {
            source_path: row.get(0)?,
            source_title: row.get(1)?,
            line: row.get(2)?,
            context: row.get(3)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Distinct paths of notes that link to `target_path`: the files a rename
/// has to rewrite.
pub fn linking_sources(conn: &Connection, target_path: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare_cached(
        "SELECT DISTINCT n.path
         FROM links l JOIN notes n ON n.id = l.source_id
         WHERE l.target_path = ?1
         ORDER BY n.path",
    )?;
    let rows = stmt.query_map([target_path], |row| row.get(0))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Unresolved links whose raw target is `raw`.
pub fn unresolved_for(conn: &Connection, raw: &str) -> Result<Vec<UnresolvedLink>> {
    unresolved(conn, Some(raw))
}

/// Every unresolved link in the vault.
pub fn unresolved_all(conn: &Connection) -> Result<Vec<UnresolvedLink>> {
    unresolved(conn, None)
}

fn unresolved(conn: &Connection, raw: Option<&str>) -> Result<Vec<UnresolvedLink>> {
    let mut stmt = conn.prepare_cached(
        "SELECT n.path, l.target_raw, l.line
         FROM links l JOIN notes n ON n.id = l.source_id
         WHERE l.target_path IS NULL
           AND (?1 IS NULL OR l.target_raw = ?1 COLLATE NOCASE)
         ORDER BY n.path, l.line",
    )?;
    let rows = stmt.query_map([raw], |row| {
        Ok(UnresolvedLink {
            source_path: row.get(0)?,
            target_raw: row.get(1)?,
            line: row.get(2)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Every link (or only the unresolved ones) with its row id and source
/// path, ordered by source path then line: the input for re-resolving links
/// after notes were added, moved or removed.
pub fn targets(conn: &Connection, unresolved_only: bool) -> Result<Vec<LinkTargetRow>> {
    let mut stmt = conn.prepare_cached(
        "SELECT l.rowid, n.path, l.target_raw, l.target_path
         FROM links l JOIN notes n ON n.id = l.source_id
         WHERE (?1 = 0 OR l.target_path IS NULL)
         ORDER BY n.path, l.line, l.rowid",
    )?;
    let rows = stmt.query_map([unresolved_only], |row| {
        Ok(LinkTargetRow {
            id: row.get(0)?,
            source_path: row.get(1)?,
            target_raw: row.get(2)?,
            target_path: row.get(3)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Set `target_path` of the single link row `id` (`None` = unresolved).
/// Returns whether the row exists.
pub fn set_target_by_id(conn: &Connection, id: i64, target_path: Option<&str>) -> Result<bool> {
    Ok(conn
        .prepare_cached("UPDATE links SET target_path = ?2 WHERE rowid = ?1")?
        .execute(params![id, target_path])?
        == 1)
}

/// Point every still-unresolved link written as `raw` at `target_path`,
/// e.g. after a note with that name is created. Returns how many changed.
pub fn resolve_raw(conn: &Connection, raw: &str, target_path: &str) -> Result<usize> {
    Ok(conn
        .prepare_cached(
            "UPDATE links SET target_path = ?2
             WHERE target_path IS NULL AND target_raw = ?1 COLLATE NOCASE",
        )?
        .execute([raw, target_path])?)
}

/// Set `target_path` on every link written as `raw`, resolved or not.
/// `None` marks them unresolved. Returns how many changed.
pub fn set_target_path(conn: &Connection, raw: &str, target_path: Option<&str>) -> Result<usize> {
    Ok(conn
        .prepare_cached("UPDATE links SET target_path = ?2 WHERE target_raw = ?1 COLLATE NOCASE")?
        .execute(params![raw, target_path])?)
}

/// Mark every link to `target_path` unresolved, e.g. after it is deleted.
pub fn unresolve_target(conn: &Connection, target_path: &str) -> Result<usize> {
    Ok(conn
        .prepare_cached("UPDATE links SET target_path = NULL WHERE target_path = ?1")?
        .execute([target_path])?)
}

/// Mark every link into `folder` unresolved.
pub fn unresolve_prefix(conn: &Connection, folder: &str) -> Result<usize> {
    Ok(conn
        .prepare_cached(&format!(
            "UPDATE links SET target_path = NULL WHERE {}",
            in_folder_target()
        ))?
        .execute([folder.trim_end_matches('/')])?)
}

/// Repoint resolved links from `old` to `new` after a note rename.
pub fn retarget(conn: &Connection, old: &str, new: &str) -> Result<usize> {
    Ok(conn
        .prepare_cached("UPDATE links SET target_path = ?2 WHERE target_path = ?1")?
        .execute([old, new])?)
}

/// Repoint resolved links into folder `old` to the same place under `new`.
pub fn retarget_prefix(conn: &Connection, old: &str, new: &str) -> Result<usize> {
    Ok(conn
        .prepare_cached(&format!(
            "UPDATE links SET target_path = ?2 || substr(target_path, length(?1) + 1) WHERE {}",
            in_folder_target()
        ))?
        .execute([old.trim_end_matches('/'), new.trim_end_matches('/')])?)
}

fn in_folder_target() -> String {
    super::notes::IN_FOLDER.replace("path", "target_path")
}
