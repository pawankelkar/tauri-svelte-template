use std::io;

use ostralith_core::CoreError;

/// Everything that can go wrong inside the vault crate.
///
/// Paths in variants are vault-relative (`/`-separated) wherever the caller
/// supplied one, so messages can cross IPC without leaking absolute paths.
#[derive(Debug, thiserror::Error)]
pub enum VaultError {
    /// The path (or the vault folder) does not exist.
    #[error("{path} not found")]
    NotFound { path: String },
    /// `write_atomic` was given an `expected_hash` that no longer matches.
    #[error("{path} changed on disk")]
    Conflict { path: String },
    /// The path escapes the vault root (`..`, absolute, or via a symlink).
    #[error("{path} is outside the vault")]
    PathOutsideVault { path: String },
    /// A create or rename whose destination is already taken.
    #[error("{path} already exists")]
    AlreadyExists { path: String },
    /// A vault-relative path that fails validation.
    #[error("invalid path {path:?}: {reason}")]
    InvalidPath { path: String, reason: String },
    /// Any other input the vault refuses to act on.
    #[error("invalid input: {message}")]
    InvalidInput { message: String },
    /// An IO error that isn't one of the above.
    #[error("{context}: {source}")]
    Io {
        context: String,
        #[source]
        source: io::Error,
    },
    /// The file watcher could not be started.
    #[error("file watcher error: {message}")]
    Watch { message: String },
}

pub type VaultResult<T> = Result<T, VaultError>;

impl VaultError {
    pub(crate) fn invalid_path(path: impl Into<String>, reason: impl Into<String>) -> Self {
        Self::InvalidPath {
            path: path.into(),
            reason: reason.into(),
        }
    }

    pub(crate) fn invalid_input(message: impl Into<String>) -> Self {
        Self::InvalidInput {
            message: message.into(),
        }
    }

    pub(crate) fn outside(path: impl Into<String>) -> Self {
        Self::PathOutsideVault { path: path.into() }
    }

    /// Wraps an IO error, promoting `NotFound`/`AlreadyExists` to the typed
    /// variants so the frontend can branch on them.
    pub(crate) fn io(path: &str, context: &str, source: io::Error) -> Self {
        match source.kind() {
            io::ErrorKind::NotFound => Self::NotFound {
                path: path.to_string(),
            },
            io::ErrorKind::AlreadyExists => Self::AlreadyExists {
                path: path.to_string(),
            },
            _ => Self::Io {
                context: format!("{context} {path}"),
                source,
            },
        }
    }
}

impl From<VaultError> for CoreError {
    fn from(err: VaultError) -> Self {
        match err {
            VaultError::NotFound { path } => CoreError::not_found(path),
            VaultError::Conflict { path } => CoreError::conflict(path),
            VaultError::PathOutsideVault { path } => CoreError::path_outside_vault(path),
            VaultError::AlreadyExists { path } => CoreError::already_exists(path),
            VaultError::InvalidPath { .. } | VaultError::InvalidInput { .. } => {
                CoreError::invalid_input(err.to_string())
            }
            VaultError::Io { .. } | VaultError::Watch { .. } => CoreError::Internal {
                message: err.to_string(),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_to_core_error_variants() {
        let core: CoreError = VaultError::Conflict {
            path: "a.md".into(),
        }
        .into();
        assert_eq!(core, CoreError::conflict("a.md"));
        let core: CoreError = VaultError::outside("../x").into();
        assert_eq!(core, CoreError::path_outside_vault("../x"));
        let core: CoreError =
            VaultError::io("a.md", "reading", io::ErrorKind::NotFound.into()).into();
        assert_eq!(core, CoreError::not_found("a.md"));
        let core: CoreError = VaultError::invalid_path("a\\b", "backslash").into();
        assert!(matches!(core, CoreError::InvalidInput { .. }));
    }
}
