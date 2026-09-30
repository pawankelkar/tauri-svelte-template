use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

/// How long an own-write record suppresses watcher events.
pub const DEFAULT_TTL: Duration = Duration::from_secs(5);

/// What the vault expects to find at a path it just changed itself.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Expected {
    /// A file with this blake3 hex hash.
    Content(String),
    /// A directory.
    Dir,
    /// Nothing (the vault moved or trashed it).
    Absent,
}

#[derive(Debug, Default)]
struct Inner {
    entries: HashMap<String, Vec<(Expected, Instant)>>,
}

/// Paths the vault itself changed recently, shared between [`crate::VaultFs`]
/// and [`crate::watcher::VaultWatcher`] so the watcher can drop the echo of
/// our own writes. Cheap to clone.
#[derive(Debug, Clone)]
pub struct RecentWrites {
    inner: Arc<Mutex<Inner>>,
    ttl: Duration,
}

impl Default for RecentWrites {
    fn default() -> Self {
        Self::new(DEFAULT_TTL)
    }
}

impl RecentWrites {
    pub fn new(ttl: Duration) -> Self {
        Self {
            inner: Arc::default(),
            ttl,
        }
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Records that `path` (vault-relative) should now look like `expected`.
    pub fn record(&self, path: &str, expected: Expected) {
        let now = Instant::now();
        let ttl = self.ttl;
        let mut inner = self.lock();
        inner
            .entries
            .retain(|_, list| list.iter().any(|(_, at)| now.duration_since(*at) < ttl));
        let list = inner.entries.entry(path.to_string()).or_default();
        list.retain(|(_, at)| now.duration_since(*at) < ttl);
        list.push((expected, now));
    }

    /// Whether anything unexpired is recorded for `path`.
    pub fn has(&self, path: &str) -> bool {
        let now = Instant::now();
        self.lock().entries.get(path).is_some_and(|list| {
            list.iter()
                .any(|(_, at)| now.duration_since(*at) < self.ttl)
        })
    }

    /// Whether `actual` matches an unexpired record for `path`.
    pub fn matches(&self, path: &str, actual: &Expected) -> bool {
        let now = Instant::now();
        self.lock().entries.get(path).is_some_and(|list| {
            list.iter()
                .any(|(e, at)| e == actual && now.duration_since(*at) < self.ttl)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_and_expires() {
        let rw = RecentWrites::new(Duration::from_millis(50));
        rw.record("a.md", Expected::Content("h1".into()));
        assert!(rw.has("a.md"));
        assert!(rw.matches("a.md", &Expected::Content("h1".into())));
        assert!(!rw.matches("a.md", &Expected::Content("h2".into())));
        assert!(!rw.matches("a.md", &Expected::Absent));
        std::thread::sleep(Duration::from_millis(80));
        assert!(!rw.has("a.md"));
        assert!(!rw.matches("a.md", &Expected::Content("h1".into())));
    }
}
