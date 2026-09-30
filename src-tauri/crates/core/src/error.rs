use serde::Serialize;
use specta::Type;

use crate::ProFeature;

/// The error every Ostralith command can return.
///
/// Serialised with a `kind` tag so the frontend can branch on the variant
/// (show an upgrade hint for `notEntitled`, an offline badge for `offline`)
/// instead of pattern-matching message strings.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error, Serialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CoreError {
    /// The feature exists but can't run here: wrong OS, missing hardware,
    /// safe mode, or a plugin that is switched off.
    #[error("{feature} is unavailable: {reason}")]
    FeatureDisabled { feature: String, reason: String },
    /// A Pro feature whose local flag is off.
    #[error("{feature:?} requires Pro")]
    NotEntitled { feature: ProFeature },
    /// A request to a non-loopback host while offline mode is on.
    #[error("offline mode blocked a request to {host}")]
    Offline { host: String },
    /// Online, but the host is not on the network allowlist.
    #[error("{host} is not on the network allowlist")]
    HostNotAllowed { host: String },
    /// A request that passed the policy but failed on the wire.
    #[error("network error: {message}")]
    Network { message: String },
    /// Input the command refuses to act on.
    #[error("invalid input: {message}")]
    InvalidInput { message: String },
    /// Anything else, carried as a message. Existing `Result<_, String>`
    /// helpers convert into this so they can be reused unchanged.
    #[error("{message}")]
    Internal { message: String },
}

pub type CoreResult<T> = Result<T, CoreError>;

impl CoreError {
    pub fn invalid_input(message: impl Into<String>) -> Self {
        Self::InvalidInput {
            message: message.into(),
        }
    }

    pub fn feature_disabled(feature: impl Into<String>, reason: impl Into<String>) -> Self {
        Self::FeatureDisabled {
            feature: feature.into(),
            reason: reason.into(),
        }
    }
}

impl From<String> for CoreError {
    fn from(message: String) -> Self {
        Self::Internal { message }
    }
}

impl From<&str> for CoreError {
    fn from(message: &str) -> Self {
        Self::Internal {
            message: message.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serialises_with_a_kind_tag() {
        let json = serde_json::to_value(CoreError::Offline {
            host: "example.com".into(),
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "kind": "offline", "host": "example.com" })
        );
    }

    #[test]
    fn not_entitled_names_the_feature() {
        let json = serde_json::to_value(CoreError::NotEntitled {
            feature: ProFeature::PdfAiQa,
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "kind": "notEntitled", "feature": "pdfAiQa" })
        );
    }

    #[test]
    fn strings_become_internal_errors() {
        let err: CoreError = "disk full".into();
        assert_eq!(err.to_string(), "disk full");
    }
}
