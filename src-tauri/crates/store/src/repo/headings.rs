//! The `headings` table: the outline of each note.

use rusqlite::{params, Connection};

use crate::records::HeadingRecord;
use crate::Result;

/// Replace the headings of `note_id`.
pub fn replace_for_note(conn: &Connection, note_id: i64, headings: &[HeadingRecord]) -> Result<()> {
    conn.prepare_cached("DELETE FROM headings WHERE note_id = ?1")?
        .execute([note_id])?;
    let mut insert = conn.prepare_cached(
        "INSERT INTO headings (note_id, level, text, slug, line) VALUES (?1, ?2, ?3, ?4, ?5)",
    )?;
    for h in headings {
        insert.execute(params![note_id, h.level, h.text, h.slug, h.line])?;
    }
    Ok(())
}

/// Headings of one note, in line order.
pub fn list_for_note(conn: &Connection, note_id: i64) -> Result<Vec<HeadingRecord>> {
    let mut stmt = conn.prepare_cached(
        "SELECT level, text, slug, line FROM headings WHERE note_id = ?1 ORDER BY line, rowid",
    )?;
    let rows = stmt.query_map([note_id], |row| {
        Ok(HeadingRecord {
            level: row.get(0)?,
            text: row.get(1)?,
            slug: row.get(2)?,
            line: row.get(3)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}
