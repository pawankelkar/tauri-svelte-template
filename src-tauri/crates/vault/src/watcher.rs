//! Debounced file watcher that reports external changes only.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use notify_debouncer_full::notify::event::{AccessKind, MetadataKind, ModifyKind, RenameMode};
use notify_debouncer_full::notify::{EventKind, RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{
    new_debouncer, DebounceEventResult, DebouncedEvent, Debouncer, RecommendedCache,
};
use serde::Serialize;

use crate::error::{VaultError, VaultResult};
use crate::fs::{hash_bytes, is_hidden_name};
use crate::path::RelPath;
use crate::recent::{Expected, RecentWrites};

/// Default debounce window.
pub const DEFAULT_DEBOUNCE: Duration = Duration::from_millis(250);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FsChangeKind {
    Created,
    Modified,
    Removed,
    Renamed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsChange {
    pub path: RelPath,
    pub kind: FsChangeKind,
    /// Set for `Renamed`.
    pub old_path: Option<RelPath>,
}

/// Watches a vault recursively and calls back with batches of external
/// changes. Hidden paths (`.ostralith/`, `.git/`, `.trash/`, dotfiles,
/// `write_atomic` temp files, `.icloud` placeholders) are ignored, and so
/// are events whose current on-disk state matches a recent own write in the
/// shared [`RecentWrites`]. Dropping the watcher stops it.
pub struct VaultWatcher {
    debouncer: Option<Debouncer<RecommendedWatcher, RecommendedCache>>,
    root: PathBuf,
}

impl std::fmt::Debug for VaultWatcher {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("VaultWatcher")
            .field("root", &self.root)
            .finish()
    }
}

impl VaultWatcher {
    /// Starts watching with the default 250 ms debounce.
    pub fn start<F>(root: &Path, recent: RecentWrites, on_changes: F) -> VaultResult<Self>
    where
        F: FnMut(Vec<FsChange>) + Send + 'static,
    {
        Self::start_with_debounce(root, recent, DEFAULT_DEBOUNCE, on_changes)
    }

    pub fn start_with_debounce<F>(
        root: &Path,
        recent: RecentWrites,
        debounce: Duration,
        mut on_changes: F,
    ) -> VaultResult<Self>
    where
        F: FnMut(Vec<FsChange>) + Send + 'static,
    {
        let root = fs::canonicalize(root).map_err(|e| VaultError::Watch {
            message: format!("{}: {e}", root.display()),
        })?;
        let handler_root = root.clone();
        let handler = move |result: DebounceEventResult| match result {
            Ok(events) => {
                let changes = collect_changes(&handler_root, &recent, &events);
                if !changes.is_empty() {
                    on_changes(changes);
                }
            }
            Err(errors) => {
                for error in errors {
                    log::warn!("vault watcher: {error}");
                }
            }
        };
        let mut debouncer =
            new_debouncer(debounce, None, handler).map_err(|e| VaultError::Watch {
                message: e.to_string(),
            })?;
        debouncer
            .watch(&root, RecursiveMode::Recursive)
            .map_err(|e| VaultError::Watch {
                message: e.to_string(),
            })?;
        Ok(Self {
            debouncer: Some(debouncer),
            root,
        })
    }

    /// The canonicalised root being watched.
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Stops the watcher and waits for its thread to finish.
    pub fn stop(mut self) {
        if let Some(debouncer) = self.debouncer.take() {
            debouncer.stop();
        }
    }
}

impl Drop for VaultWatcher {
    fn drop(&mut self) {
        if let Some(debouncer) = self.debouncer.take() {
            debouncer.stop_nonblocking();
        }
    }
}

/// A visible vault-relative path for `abs`, or `None` if it's outside the
/// root or hidden.
fn visible_rel(root: &Path, abs: &Path) -> Option<RelPath> {
    let rel = abs.strip_prefix(root).ok()?;
    let rel = RelPath::from_os_relative(rel).ok()?;
    if rel.segments().any(is_hidden_name) {
        return None;
    }
    Some(rel)
}

fn current_state(abs: &Path) -> Expected {
    match fs::metadata(abs) {
        Ok(meta) if meta.is_dir() => Expected::Dir,
        Ok(_) => match fs::read(abs) {
            Ok(bytes) => Expected::Content(hash_bytes(bytes)),
            Err(_) => Expected::Absent,
        },
        Err(_) => Expected::Absent,
    }
}

/// Raw per-event classification, before own-write filtering and merging.
fn classify(root: &Path, event: &DebouncedEvent, out: &mut Vec<FsChange>) {
    let exists = |p: &Path| fs::symlink_metadata(p).is_ok();
    let simple = |kind: FsChangeKind, out: &mut Vec<FsChange>| {
        for path in &event.paths {
            if let Some(rel) = visible_rel(root, path) {
                out.push(FsChange {
                    path: rel,
                    kind,
                    old_path: None,
                });
            }
        }
    };
    let by_existence = |out: &mut Vec<FsChange>, present: FsChangeKind| {
        for path in &event.paths {
            if let Some(rel) = visible_rel(root, path) {
                let kind = if exists(path) {
                    present
                } else {
                    FsChangeKind::Removed
                };
                out.push(FsChange {
                    path: rel,
                    kind,
                    old_path: None,
                });
            }
        }
    };
    match &event.kind {
        EventKind::Access(AccessKind::Close(_)) | EventKind::Access(_) => {}
        EventKind::Create(_) => simple(FsChangeKind::Created, out),
        EventKind::Remove(_) => simple(FsChangeKind::Removed, out),
        EventKind::Modify(ModifyKind::Name(RenameMode::Both)) if event.paths.len() == 2 => {
            let old = visible_rel(root, &event.paths[0]);
            let new = visible_rel(root, &event.paths[1]);
            match (old, new) {
                (Some(old), Some(new)) => out.push(FsChange {
                    path: new,
                    kind: FsChangeKind::Renamed,
                    old_path: Some(old),
                }),
                // Temp file renamed into place, or moved in from a hidden
                // folder: a creation. Moved into `.trash`: a removal.
                (None, Some(new)) => out.push(FsChange {
                    path: new,
                    kind: FsChangeKind::Created,
                    old_path: None,
                }),
                (Some(old), None) => out.push(FsChange {
                    path: old,
                    kind: FsChangeKind::Removed,
                    old_path: None,
                }),
                (None, None) => {}
            }
        }
        EventKind::Modify(ModifyKind::Name(_)) => by_existence(out, FsChangeKind::Created),
        EventKind::Modify(ModifyKind::Metadata(MetadataKind::AccessTime)) => {}
        EventKind::Modify(_) | EventKind::Any | EventKind::Other => {
            by_existence(out, FsChangeKind::Modified)
        }
    }
}

/// Turns one debounced batch into the external changes to report.
fn collect_changes(root: &Path, recent: &RecentWrites, events: &[DebouncedEvent]) -> Vec<FsChange> {
    let mut raw = Vec::new();
    for event in events {
        classify(root, event, &mut raw);
    }

    let abs = |rel: &RelPath| {
        let mut p = root.to_path_buf();
        for seg in rel.segments() {
            p.push(seg);
        }
        p
    };
    let is_own = |rel: &RelPath| {
        recent.has(rel.as_str()) && recent.matches(rel.as_str(), &current_state(&abs(rel)))
    };

    // Merge per path, keeping first-seen order.
    let mut merged: Vec<FsChange> = Vec::new();
    let mut index: HashMap<RelPath, usize> = HashMap::new();
    for change in raw {
        if change.kind == FsChangeKind::Renamed {
            merged.push(change);
            continue;
        }
        match index.get(&change.path) {
            Some(&i) => {
                let prev = merged[i].kind;
                merged[i].kind = match (prev, change.kind) {
                    (FsChangeKind::Created, FsChangeKind::Modified) => FsChangeKind::Created,
                    (FsChangeKind::Removed, FsChangeKind::Created) => FsChangeKind::Modified,
                    (_, next) => next,
                };
            }
            None => {
                index.insert(change.path.clone(), merged.len());
                merged.push(change);
            }
        }
    }

    merged
        .into_iter()
        .filter_map(|mut change| {
            let present = fs::symlink_metadata(abs(&change.path)).is_ok();
            match change.kind {
                FsChangeKind::Renamed => {
                    let old = change.old_path.as_ref()?;
                    if is_own(&change.path) && is_own(old) {
                        return None;
                    }
                    if !present {
                        change.kind = FsChangeKind::Removed;
                        change.path = change.old_path.take()?;
                    }
                }
                FsChangeKind::Created | FsChangeKind::Modified if !present => {
                    change.kind = FsChangeKind::Removed;
                }
                FsChangeKind::Removed if present => change.kind = FsChangeKind::Modified,
                _ => {}
            }
            if change.kind != FsChangeKind::Renamed && is_own(&change.path) {
                return None;
            }
            Some(change)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc;
    use std::time::Instant;

    use notify_debouncer_full::notify::event::{CreateKind, DataChange, Event, RemoveKind};

    use super::*;
    use crate::fs::VaultFs;

    fn event(kind: EventKind, paths: Vec<PathBuf>) -> DebouncedEvent {
        DebouncedEvent::new(
            Event {
                kind,
                paths,
                attrs: Default::default(),
            },
            Instant::now(),
        )
    }

    #[test]
    fn classifies_filters_and_merges() {
        let dir = tempfile::tempdir().unwrap();
        let fs = VaultFs::new(dir.path()).unwrap();
        let root = fs.root().to_path_buf();
        let own = RelPath::new("own.md").unwrap();
        fs.write_atomic(&own, "mine", None).unwrap();
        std::fs::write(root.join("ext.md"), "theirs").unwrap();
        std::fs::create_dir_all(root.join(".git")).unwrap();
        std::fs::write(root.join(".git/index"), "x").unwrap();

        let modify = EventKind::Modify(ModifyKind::Data(DataChange::Content));
        let events = vec![
            event(
                EventKind::Create(CreateKind::File),
                vec![root.join("own.md")],
            ),
            event(modify, vec![root.join("own.md")]),
            event(
                EventKind::Create(CreateKind::File),
                vec![root.join("ext.md")],
            ),
            event(modify, vec![root.join("ext.md")]),
            event(modify, vec![root.join(".git/index")]),
            event(
                EventKind::Create(CreateKind::File),
                vec![root.join(".ostralith-tmp-abc")],
            ),
            event(
                EventKind::Remove(RemoveKind::File),
                vec![root.join("gone.md")],
            ),
        ];
        let changes = collect_changes(&root, fs.recent_writes(), &events);
        let got: Vec<(&str, FsChangeKind)> =
            changes.iter().map(|c| (c.path.as_str(), c.kind)).collect();
        assert_eq!(
            got,
            [
                ("ext.md", FsChangeKind::Created),
                ("gone.md", FsChangeKind::Removed)
            ]
        );

        // Someone else overwrites our file: now reported.
        std::fs::write(root.join("own.md"), "edited elsewhere").unwrap();
        let changes = collect_changes(
            &root,
            fs.recent_writes(),
            &[event(modify, vec![root.join("own.md")])],
        );
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].kind, FsChangeKind::Modified);
    }

    #[test]
    fn own_renames_are_ignored_external_ones_reported() {
        let dir = tempfile::tempdir().unwrap();
        let fs = VaultFs::new(dir.path()).unwrap();
        let root = fs.root().to_path_buf();
        let a = RelPath::new("a.md").unwrap();
        let b = RelPath::new("b.md").unwrap();
        fs.write_atomic(&a, "x", None).unwrap();
        fs.rename(&a, &b).unwrap();
        let rename = EventKind::Modify(ModifyKind::Name(RenameMode::Both));
        let ev = event(rename, vec![root.join("a.md"), root.join("b.md")]);
        assert!(collect_changes(&root, fs.recent_writes(), &[ev]).is_empty());

        std::fs::rename(root.join("b.md"), root.join("c.md")).unwrap();
        let ev = event(rename, vec![root.join("b.md"), root.join("c.md")]);
        let changes = collect_changes(&root, &RecentWrites::default(), &[ev]);
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].kind, FsChangeKind::Renamed);
        assert_eq!(changes[0].path.as_str(), "c.md");
        assert_eq!(changes[0].old_path.as_ref().unwrap().as_str(), "b.md");

        // Trashing is our own removal.
        let c = RelPath::new("c.md").unwrap();
        fs.trash(&c).unwrap();
        let ev = event(EventKind::Remove(RemoveKind::File), vec![root.join("c.md")]);
        assert!(collect_changes(&root, fs.recent_writes(), &[ev]).is_empty());
    }

    /// End-to-end with the real OS watcher. Generous timeouts keep it
    /// stable on slow CI machines.
    #[test]
    fn watcher_ignores_own_writes_but_reports_external_ones() {
        let dir = tempfile::tempdir().unwrap();
        let fs = VaultFs::new(dir.path()).unwrap();
        let (tx, rx) = mpsc::channel::<Vec<FsChange>>();
        let watcher = VaultWatcher::start(fs.root(), fs.recent_writes().clone(), move |batch| {
            let _ = tx.send(batch);
        })
        .unwrap();
        // FSEvents needs a moment before it delivers events.
        std::thread::sleep(Duration::from_millis(500));

        fs.write_atomic(&RelPath::new("own.md").unwrap(), "mine", None)
            .unwrap();
        fs.write_atomic(&RelPath::new("newdir/own2.md").unwrap(), "mine too", None)
            .unwrap();
        std::thread::sleep(Duration::from_millis(100));
        std::fs::write(fs.root().join("external.md"), "theirs").unwrap();

        let mut seen: Vec<FsChange> = Vec::new();
        let deadline = Instant::now() + Duration::from_secs(15);
        while Instant::now() < deadline && !seen.iter().any(|c| c.path.as_str() == "external.md") {
            if let Ok(batch) = rx.recv_timeout(Duration::from_millis(200)) {
                seen.extend(batch);
            }
        }
        // Let any straggling events for our own write arrive.
        let settle = Instant::now() + Duration::from_millis(1000);
        while Instant::now() < settle {
            if let Ok(batch) = rx.recv_timeout(Duration::from_millis(100)) {
                seen.extend(batch);
            }
        }
        watcher.stop();

        assert!(
            seen.iter().any(|c| c.path.as_str() == "external.md"),
            "external write not reported: {seen:?}"
        );
        assert!(
            seen.iter()
                .all(|c| !matches!(c.path.as_str(), "own.md" | "newdir" | "newdir/own2.md")),
            "own write leaked: {seen:?}"
        );
    }
}
