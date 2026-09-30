use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use specta::Type;
use url::Url;

/// How many requests the in-memory log keeps. Older entries fall off.
const CAPACITY: usize = 500;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum RequestOutcome {
    /// Passed the policy and was sent (it may still have failed on the wire;
    /// see `error`).
    Sent,
    /// Stopped by the policy before any IO.
    Blocked,
}

/// One entry of the network activity log.
#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RequestRecord {
    /// Milliseconds since the Unix epoch. `f64` rather than `u64` so the
    /// TypeScript side gets a plain `number`.
    pub timestamp_ms: f64,
    pub method: String,
    pub host: String,
    /// Scheme, host, port and path. Query strings and fragments are dropped
    /// because they routinely carry tokens.
    pub url: String,
    /// Why the request was made, e.g. `model-download` or `updater`.
    pub purpose: String,
    pub outcome: RequestOutcome,
    pub status: Option<u16>,
    /// The response's declared `Content-Length`, when it has one.
    pub bytes: Option<f64>,
    pub error: Option<String>,
}

impl RequestRecord {
    pub(crate) fn new(method: &str, url: &Url, purpose: &str, outcome: RequestOutcome) -> Self {
        let mut redacted = url.clone();
        redacted.set_query(None);
        redacted.set_fragment(None);
        let _ = redacted.set_username("");
        let _ = redacted.set_password(None);
        Self {
            timestamp_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis() as f64)
                .unwrap_or(0.0),
            method: method.to_string(),
            host: url.host_str().unwrap_or_default().to_string(),
            url: redacted.to_string(),
            purpose: purpose.to_string(),
            outcome,
            status: None,
            bytes: None,
            error: None,
        }
    }
}

/// Bounded, newest-last log of request attempts.
#[derive(Debug, Default)]
pub(crate) struct ActivityLog {
    entries: Mutex<VecDeque<RequestRecord>>,
}

impl ActivityLog {
    pub(crate) fn push(&self, record: RequestRecord) {
        let mut entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        if entries.len() == CAPACITY {
            entries.pop_front();
        }
        entries.push_back(record);
    }

    pub(crate) fn snapshot(&self) -> Vec<RequestRecord> {
        let entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        entries.iter().cloned().collect()
    }

    pub(crate) fn clear(&self) {
        self.entries
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_drop_secrets_from_the_url() {
        let url = Url::parse("https://user:pw@example.com/a/b?token=secret#frag").unwrap();
        let r = RequestRecord::new("GET", &url, "test", RequestOutcome::Sent);
        assert_eq!(r.url, "https://example.com/a/b");
        assert_eq!(r.host, "example.com");
    }

    #[test]
    fn log_is_bounded() {
        let log = ActivityLog::default();
        let url = Url::parse("https://example.com/").unwrap();
        for i in 0..CAPACITY + 5 {
            log.push(RequestRecord::new(
                &format!("M{i}"),
                &url,
                "t",
                RequestOutcome::Blocked,
            ));
        }
        let snap = log.snapshot();
        assert_eq!(snap.len(), CAPACITY);
        assert_eq!(snap[0].method, "M5");
        log.clear();
        assert!(log.snapshot().is_empty());
    }
}
