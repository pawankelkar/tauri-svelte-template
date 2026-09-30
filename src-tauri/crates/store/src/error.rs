use std::path::PathBuf;

use ostralith_core::CoreError;
use rusqlite::ErrorCode;

pub type Result<T, E = StoreError> = std::result::Result<T, E>;

/// Everything that can go wrong in the store.
///
/// The key-related variants are deliberately separate from [`Corrupt`]:
/// [`Db::open_or_recover`] throws a corrupt cache away and rebuilds it, but
/// a key mismatch means the file is fine and the *key* is the problem, so
/// discarding it would hide the real fault.
///
/// [`Corrupt`]: StoreError::Corrupt
/// [`Db::open_or_recover`]: crate::Db::open_or_recover
#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    /// The file is encrypted and the key is missing or not the one it was
    /// encrypted with.
    #[error("the database is encrypted and the key is missing or wrong")]
    WrongKey,
    /// A key was supplied but the file is a plain SQLite database.
    #[error("the database is not encrypted but a key was supplied")]
    NotEncrypted,
    /// The file is not a usable database: garbage, truncated, or failing
    /// SQLite's integrity check.
    #[error("the database is corrupt: {message}")]
    Corrupt { message: String },
    /// The file was written by a newer build with migrations this one
    /// doesn't know.
    #[error("the database schema is newer than this version of Ostralith supports")]
    SchemaTooNew,
    /// A migration failed to apply.
    #[error("database migration failed: {message}")]
    Migration { message: String },
    /// Any other SQLite error.
    #[error("database error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    /// Filesystem IO around the database file (recovery, rekey, key files).
    #[error("{}: {source}", path.display())]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    /// Loading, creating or deleting a database key failed.
    #[error("database key error: {message}")]
    Key { message: String },
}

impl StoreError {
    pub(crate) fn io(path: impl Into<PathBuf>, source: std::io::Error) -> Self {
        Self::Io {
            path: path.into(),
            source,
        }
    }

    pub(crate) fn key(message: impl Into<String>) -> Self {
        Self::Key {
            message: message.into(),
        }
    }

    /// Whether this error means the file itself is damaged (as opposed to a
    /// key mismatch, a busy database or an IO problem), so rebuilding the
    /// cache from the markdown files is the right fix.
    pub fn is_corruption(&self) -> bool {
        match self {
            Self::Corrupt { .. } | Self::SchemaTooNew => true,
            Self::Sqlite(err) => is_corrupt_code(err),
            _ => false,
        }
    }
}

/// `SQLITE_CORRUPT` or `SQLITE_NOTADB`.
pub(crate) fn is_corrupt_code(err: &rusqlite::Error) -> bool {
    matches!(
        err.sqlite_error_code(),
        Some(ErrorCode::DatabaseCorrupt | ErrorCode::NotADatabase)
    )
}

impl From<rusqlite_migration::Error> for StoreError {
    fn from(err: rusqlite_migration::Error) -> Self {
        use rusqlite_migration::{Error, MigrationDefinitionError, SchemaVersionError};
        match err {
            Error::RusqliteError { err, .. } if is_corrupt_code(&err) => Self::Corrupt {
                message: err.to_string(),
            },
            Error::MigrationDefinition(MigrationDefinitionError::DatabaseTooFarAhead)
            | Error::SpecifiedSchemaVersion(SchemaVersionError::TooHigh) => Self::SchemaTooNew,
            other => Self::Migration {
                message: other.to_string(),
            },
        }
    }
}

impl From<StoreError> for CoreError {
    fn from(err: StoreError) -> Self {
        CoreError::Internal {
            message: err.to_string(),
        }
    }
}
