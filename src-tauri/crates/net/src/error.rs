use ostralith_core::CoreError;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum NetError {
    #[error("offline mode blocked a request to {host}")]
    Offline { host: String },
    #[error("{host} is not on the network allowlist")]
    HostNotAllowed { host: String },
    #[error("unsupported URL scheme '{scheme}'")]
    UnsupportedScheme { scheme: String },
    #[error("invalid URL: {message}")]
    InvalidUrl { message: String },
    #[error("request failed: {message}")]
    Http { message: String },
}

impl From<NetError> for CoreError {
    fn from(err: NetError) -> Self {
        match err {
            NetError::Offline { host } => CoreError::Offline { host },
            NetError::HostNotAllowed { host } => CoreError::HostNotAllowed { host },
            NetError::UnsupportedScheme { .. } | NetError::InvalidUrl { .. } => {
                CoreError::invalid_input(err.to_string())
            }
            NetError::Http { message } => CoreError::Network { message },
        }
    }
}
