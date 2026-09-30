//! The `meta` table: small key/value settings of the index itself (for
//! example the parser version the notes were indexed with).

use rusqlite::{Connection, OptionalExtension};

use crate::Result;

pub fn get(conn: &Connection, key: &str) -> Result<Option<String>> {
    Ok(conn
        .prepare_cached("SELECT value FROM meta WHERE key = ?1")?
        .query_row([key], |row| row.get::<_, Option<String>>(0))
        .optional()?
        .flatten())
}

pub fn set(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.prepare_cached(
        "INSERT INTO meta (key, value) VALUES (?1, ?2)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    )?
    .execute([key, value])?;
    Ok(())
}

pub fn delete(conn: &Connection, key: &str) -> Result<bool> {
    Ok(conn
        .prepare_cached("DELETE FROM meta WHERE key = ?1")?
        .execute([key])?
        > 0)
}

pub fn delete_all(conn: &Connection) -> Result<usize> {
    Ok(conn.execute("DELETE FROM meta", [])?)
}
