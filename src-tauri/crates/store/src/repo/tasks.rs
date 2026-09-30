//! The `tasks` table: checklist items per note.

use rusqlite::{params, Connection};

use crate::records::TaskRecord;
use crate::Result;

/// Replace the tasks of `note_id`.
pub fn replace_for_note(conn: &Connection, note_id: i64, tasks: &[TaskRecord]) -> Result<()> {
    conn.prepare_cached("DELETE FROM tasks WHERE note_id = ?1")?
        .execute([note_id])?;
    let mut insert = conn
        .prepare_cached("INSERT INTO tasks (note_id, line, text, done) VALUES (?1, ?2, ?3, ?4)")?;
    for t in tasks {
        insert.execute(params![note_id, t.line, t.text, t.done])?;
    }
    Ok(())
}

/// Tasks of one note, in line order.
pub fn list_for_note(conn: &Connection, note_id: i64) -> Result<Vec<TaskRecord>> {
    let mut stmt = conn.prepare_cached(
        "SELECT line, text, done FROM tasks WHERE note_id = ?1 ORDER BY line, rowid",
    )?;
    let rows = stmt.query_map([note_id], |row| {
        Ok(TaskRecord {
            line: row.get(0)?,
            text: row.get(1)?,
            done: row.get(2)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}
