//! Versioned schema migrations, tracked in `PRAGMA user_version`.
//!
//! Append new files as `migrations/NNN_name.sql` and add them to the end of
//! [`MIGRATIONS`]; never edit one that has shipped.

use rusqlite_migration::{Migrations, M};

const STEPS: &[M<'static>] = &[M::up(include_str!("../migrations/001_initial.sql"))];

pub(crate) static MIGRATIONS: Migrations<'static> = Migrations::from_slice(STEPS);

/// The schema version a fully migrated database reports.
pub const SCHEMA_VERSION: u32 = STEPS.len() as u32;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_are_valid() {
        MIGRATIONS.validate().unwrap();
    }

    #[test]
    fn migrations_apply_from_empty() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        MIGRATIONS.to_latest(&mut conn).unwrap();
        let version: u32 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);
        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(
            tables,
            ["headings", "links", "meta", "notes", "tags", "tasks"]
        );
    }
}
