//! The per-vault cache database behind the notes index.
//!
//! The markdown files are the source of truth; this database only caches
//! what was parsed out of them (titles, links, tags, headings, tasks) so
//! backlinks and lookups don't have to reread the vault. It can always be
//! thrown away and rebuilt, which is exactly what
//! [`Db::open_or_recover`] does when the file is damaged.
//!
//! The file is SQLCipher-encrypted when the vault asks for it, with a
//! random key kept in the OS keychain ([`key`]). SQLCipher reads plain
//! SQLite files too, so one build serves both modes and [`Db::rekey`]
//! converts between them.
//!
//! SQL lives only in [`repo`]. [`Db`] owns the connections and adds the
//! few multi-table operations (indexing a note, renames, deletes) that must
//! run in one transaction. The API is synchronous.

mod db;
mod error;
pub mod key;
mod migrations;
mod records;
pub mod repo;

pub use db::{Db, Encryption, OpenOutcome};
pub use error::{Result, StoreError};
pub use migrations::SCHEMA_VERSION;
pub use records::{
    BacklinkRow, DbStats, HeadingRecord, LinkRecord, LinkTargetRow, NoteMeta, NoteRecord, NoteRow,
    TagCount, TaskRecord, UnresolvedLink,
};
/// Re-exported so callers of [`Db::read`] and [`Db::write`] can name the
/// connection types without depending on `rusqlite` themselves.
pub use rusqlite::{Connection, Transaction};
pub use zeroize::Zeroizing;
