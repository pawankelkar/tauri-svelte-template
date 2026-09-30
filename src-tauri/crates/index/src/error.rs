use ostralith_core::CoreError;

/// Errors from the search index.
///
/// Malformed search input is *not* an error: the query parser is lenient
/// and degrades to "no results" instead. [`IndexError::Query`] only covers
/// queries tantivy itself refuses to run.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum IndexError {
    #[error("search index IO failed: {message}")]
    Io { message: String },
    #[error("search index failed: {message}")]
    Tantivy { message: String },
    #[error("invalid search query: {message}")]
    Query { message: String },
    #[error("refusing to reset {path}: it does not look like a search index")]
    NotAnIndex { path: String },
}

pub type Result<T, E = IndexError> = std::result::Result<T, E>;

impl From<std::io::Error> for IndexError {
    fn from(err: std::io::Error) -> Self {
        Self::Io {
            message: err.to_string(),
        }
    }
}

impl From<tantivy::TantivyError> for IndexError {
    fn from(err: tantivy::TantivyError) -> Self {
        match err {
            tantivy::TantivyError::InvalidArgument(message) => Self::Query { message },
            other => Self::Tantivy {
                message: other.to_string(),
            },
        }
    }
}

impl From<IndexError> for CoreError {
    fn from(err: IndexError) -> Self {
        match err {
            IndexError::Query { .. } => CoreError::invalid_input(err.to_string()),
            _ => CoreError::Internal {
                message: err.to_string(),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_into_core_errors() {
        let bad = IndexError::Query {
            message: "nope".into(),
        };
        assert!(matches!(
            CoreError::from(bad),
            CoreError::InvalidInput { .. }
        ));
        assert!(matches!(
            CoreError::from(IndexError::Io {
                message: "disk full".into()
            }),
            CoreError::Internal { .. }
        ));
    }
}
