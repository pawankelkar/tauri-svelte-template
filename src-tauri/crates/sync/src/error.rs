use ostralith_core::CoreError;

/// Everything the git backup can fail with.
///
/// Remote operations (`push`, `fetch`, `pull`) classify libgit2's errors into
/// [`SyncError::Auth`], [`SyncError::Network`] and [`SyncError::Rejected`] so
/// the UI can tell "fix your credentials" from "you're offline" from "the
/// remote has commits you don't".
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SyncError {
    /// The vault folder is not a git repository (call `GitBackup::init`).
    #[error("{path} is not a git repository")]
    NotARepo { path: String },
    /// A file or commit that doesn't exist (e.g. a note absent at a snapshot).
    #[error("{what} not found")]
    NotFound { what: String },
    /// A path that is not a clean vault-relative `/`-separated path.
    #[error("invalid vault path: {path}")]
    InvalidPath { path: String },
    /// The blob at that revision is not UTF-8 text.
    #[error("{path} is not a text file")]
    NotText { path: String },
    /// A remote URL we refuse to store (empty, or with an embedded password).
    #[error("invalid remote URL: {message}")]
    InvalidRemote { message: String },
    /// Push/fetch/pull without an `origin` remote.
    #[error("no backup remote is configured")]
    NoRemote,
    /// HEAD is detached or otherwise not on a branch we can push.
    #[error("the backup repository is not on a branch")]
    NoBranch,
    /// The remote refused our credentials (or we had none to offer).
    #[error("authentication failed: {message}")]
    Auth { message: String },
    /// Could not reach the remote: DNS, TLS, connection refused, timeout.
    #[error("network error: {message}")]
    Network { message: String },
    /// The remote rejected the update, usually because it is not a
    /// fast-forward (another device pushed first).
    #[error("push rejected: {message}")]
    Rejected { message: String },
    /// A pull needs a clean working tree; snapshot first.
    #[error("the vault has unsnapshotted changes")]
    Dirty,
    /// Any other libgit2 or filesystem error.
    #[error("git error: {message}")]
    Git { message: String },
    #[error("io error: {message}")]
    Io { message: String },
}

pub type Result<T, E = SyncError> = std::result::Result<T, E>;

impl From<git2::Error> for SyncError {
    fn from(err: git2::Error) -> Self {
        SyncError::Git {
            message: err.message().to_string(),
        }
    }
}

impl From<std::io::Error> for SyncError {
    fn from(err: std::io::Error) -> Self {
        SyncError::Io {
            message: err.to_string(),
        }
    }
}

impl From<SyncError> for CoreError {
    fn from(err: SyncError) -> Self {
        match err {
            SyncError::NotFound { what } => CoreError::NotFound { what },
            SyncError::InvalidPath { .. }
            | SyncError::NotText { .. }
            | SyncError::NoRemote
            | SyncError::InvalidRemote { .. }
            | SyncError::NotARepo { .. } => CoreError::invalid_input(err.to_string()),
            SyncError::Network { message } => CoreError::Network { message },
            SyncError::Auth { .. } => CoreError::Network {
                message: err.to_string(),
            },
            SyncError::Rejected { .. }
            | SyncError::NoBranch
            | SyncError::Dirty
            | SyncError::Git { .. }
            | SyncError::Io { .. } => CoreError::Internal {
                message: err.to_string(),
            },
        }
    }
}

/// Classify an error from a remote operation.
///
/// `auth_exhausted` is set by our credentials callback when it ran out of
/// things to offer; libgit2 then reports a generic error, which is really an
/// authentication failure.
pub(crate) fn remote_error(err: git2::Error, auth_exhausted: bool) -> SyncError {
    use git2::{ErrorClass, ErrorCode};
    let message = err.message().to_string();
    if auth_exhausted || err.code() == ErrorCode::Auth {
        return SyncError::Auth { message };
    }
    match err.code() {
        ErrorCode::NotFastForward | ErrorCode::Modified | ErrorCode::Locked => {
            return SyncError::Rejected { message }
        }
        ErrorCode::Certificate => return SyncError::Network { message },
        _ => {}
    }
    match err.class() {
        ErrorClass::Net | ErrorClass::Http | ErrorClass::Ssl | ErrorClass::Os => {
            SyncError::Network { message }
        }
        // libssh2 reports refused keys as a generic SSH error.
        ErrorClass::Ssh if message.to_ascii_lowercase().contains("auth") => {
            SyncError::Auth { message }
        }
        ErrorClass::Ssh => SyncError::Network { message },
        _ => SyncError::Git { message },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_remote_errors() {
        let auth = git2::Error::new(git2::ErrorCode::Auth, git2::ErrorClass::Http, "401");
        assert!(matches!(remote_error(auth, false), SyncError::Auth { .. }));

        let nff = git2::Error::new(
            git2::ErrorCode::NotFastForward,
            git2::ErrorClass::Reference,
            "cannot push non-fastforwardable reference",
        );
        assert!(matches!(
            remote_error(nff, false),
            SyncError::Rejected { .. }
        ));

        let net = git2::Error::new(
            git2::ErrorCode::GenericError,
            git2::ErrorClass::Net,
            "failed to resolve address",
        );
        assert!(matches!(
            remote_error(net, false),
            SyncError::Network { .. }
        ));

        let generic = git2::Error::new(git2::ErrorCode::GenericError, git2::ErrorClass::None, "x");
        assert!(matches!(
            remote_error(generic, true),
            SyncError::Auth { .. }
        ));
    }

    #[test]
    fn converts_into_core_errors() {
        let core: CoreError = SyncError::Network {
            message: "offline".into(),
        }
        .into();
        assert_eq!(
            core,
            CoreError::Network {
                message: "offline".into()
            }
        );
        let core: CoreError = SyncError::NotFound {
            what: "a.md at snapshot 0123".into(),
        }
        .into();
        assert_eq!(core, CoreError::not_found("a.md at snapshot 0123"));
        let core: CoreError = SyncError::NoRemote.into();
        assert!(matches!(core, CoreError::InvalidInput { .. }));
    }
}
