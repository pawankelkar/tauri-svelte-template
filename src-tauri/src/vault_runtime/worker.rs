//! The per-vault background thread: initial/incremental sync, full
//! rebuilds, link re-resolution and external file changes, in queue order.

use std::collections::HashMap;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::Ordering;
use std::sync::mpsc::{Receiver, Sender};
use std::sync::Weak;
use std::time::{Duration, Instant};

use ostralith_core::CoreError;
use ostralith_vault::links::LinkResolver;
use ostralith_vault::{FsChange, FsChangeKind, NoteEntry, RelPath};

use super::open_vault::{OpenVault, COMMIT_EVERY};
use super::{convert, lock};
use crate::commands::vault::FsChangedPayload;

pub(super) enum Job {
    /// Bring the DB and search index in line with the disk; `full` clears
    /// both first.
    Sync { full: bool },
    /// Re-resolve every stored link.
    Relink,
    /// A debounced batch of external changes from the watcher.
    FsChanges(Vec<FsChange>),
    /// Replies once every earlier job has run (tests).
    #[cfg_attr(not(test), allow(dead_code))]
    Barrier(Sender<()>),
}

/// Emit progress at most this often during a sync...
const STATUS_INTERVAL: Duration = Duration::from_millis(200);
/// ...or after this many notes, whichever comes first.
const STATUS_EVERY: u32 = 100;

pub(super) fn run(vault: Weak<OpenVault>, jobs: Receiver<Job>) {
    while let Ok(job) = jobs.recv() {
        let Some(vault) = vault.upgrade() else { break };
        if vault.cancel.load(Ordering::SeqCst) {
            break;
        }
        let outcome = catch_unwind(AssertUnwindSafe(|| run_job(&vault, job)));
        if outcome.is_err() {
            log::error!("The indexer panicked; continuing with the next job");
            vault.progress.indexing.store(false, Ordering::SeqCst);
        }
    }
}

fn run_job(vault: &OpenVault, job: Job) {
    match job {
        Job::Sync { full } => {
            if let Err(e) = vault.sync(full) {
                log::error!("Indexing {} failed: {e}", vault.info().path);
            }
            vault.progress.indexing.store(false, Ordering::SeqCst);
            vault.emit_status();
        }
        Job::Relink => {
            vault.relink_queued.store(false, Ordering::SeqCst);
            match vault.relink(false) {
                Ok(0) => {}
                Ok(n) => log::debug!("Re-resolved {n} links"),
                Err(e) => log::warn!("Re-resolving links failed: {e}"),
            }
        }
        Job::FsChanges(changes) => vault.handle_fs_changes(&changes),
        Job::Barrier(reply) => {
            let _ = reply.send(());
        }
    }
}

impl OpenVault {
    /// Incremental: notes whose mtime matches the DB are skipped, changed
    /// and new ones are read and indexed, and DB rows without a file are
    /// dropped. Links are then re-resolved if anything changed.
    pub(super) fn sync(&self, full: bool) -> Result<(), CoreError> {
        let started = Instant::now();
        self.progress.indexing.store(true, Ordering::SeqCst);
        self.progress.done.store(0, Ordering::SeqCst);
        self.progress.total.store(0, Ordering::SeqCst);
        if full {
            let _guard = lock(&self.index_lock);
            self.db.clear()?;
            self.search.clear()?;
            self.search.commit()?;
            lock(&self.notes).clear();
        }

        let fs = self.vault.fs();
        let mut entries: Vec<NoteEntry> = fs.walk_notes().collect();
        entries.sort_by(|a, b| a.path.cmp(&b.path));
        let mut known: HashMap<String, f64> = self
            .db
            .list_all_meta()?
            .into_iter()
            .map(|m| (m.path, m.mtime))
            .collect();
        let paths: Vec<RelPath> = entries.iter().map(|e| e.path.clone()).collect();
        let resolver = LinkResolver::new(&paths);
        self.progress
            .total
            .store(entries.len() as u32, Ordering::SeqCst);
        self.emit_status();

        let mut changed = 0u32;
        let mut uncommitted = 0u32;
        let mut last_emit = Instant::now();
        for (i, entry) in entries.iter().enumerate() {
            if self.cancel.load(Ordering::Relaxed) {
                return Ok(());
            }
            let unchanged = known
                .remove(entry.path.as_str())
                .is_some_and(|mtime| mtime == entry.mtime_ms);
            if !unchanged {
                let _guard = lock(&self.index_lock);
                match self.index_file(&entry.path, &resolver) {
                    Ok(_) => {
                        changed += 1;
                        uncommitted += 1;
                    }
                    Err(e) => log::warn!("Skipping {}: {e}", entry.path),
                }
                if uncommitted >= COMMIT_EVERY {
                    self.search.commit()?;
                    uncommitted = 0;
                }
            }
            let done = i as u32 + 1;
            self.progress.done.store(done, Ordering::SeqCst);
            if done % STATUS_EVERY == 0 || last_emit.elapsed() >= STATUS_INTERVAL {
                self.emit_status();
                last_emit = Instant::now();
            }
        }

        // In the DB but not on disk. Re-check the disk under the lock: a
        // command may have created the note after the walk.
        for path in known.into_keys() {
            let _guard = lock(&self.index_lock);
            let still_there = RelPath::new(path.as_str())
                .map(|rel| fs.exists(&rel))
                .unwrap_or(false);
            if !still_there {
                self.unindex_note(&path)?;
                changed += 1;
            }
        }
        {
            let _guard = lock(&self.index_lock);
            self.search.commit()?;
        }
        // A full rebuild resolved every link against the final note set
        // already; an incremental one leaves older notes' links stale.
        if !full && changed > 0 {
            self.relink(false)?;
        }
        log::info!(
            "Indexed {} ({} notes, {changed} changed{}) in {:?}",
            self.info().path,
            entries.len(),
            if full { ", full rebuild" } else { "" },
            started.elapsed()
        );
        Ok(())
    }

    /// Applies a batch of external changes to the DB, search and cache,
    /// then tells the frontend. Folders and non-note files are reported but
    /// only notes are indexed.
    pub(crate) fn handle_fs_changes(&self, changes: &[FsChange]) {
        let mut set_changed = false;
        let mut touched = false;
        {
            let _guard = lock(&self.index_lock);
            for change in changes {
                if self.cancel.load(Ordering::Relaxed) {
                    return;
                }
                if let Some(old) = change
                    .old_path
                    .as_ref()
                    .filter(|_| change.kind == FsChangeKind::Renamed)
                {
                    let outcome = self.path_removed(old);
                    self.note_outcome(outcome, &mut set_changed, &mut touched);
                }
                let outcome = match change.kind {
                    FsChangeKind::Removed if !self.vault.fs().exists(&change.path) => {
                        self.path_removed(&change.path)
                    }
                    _ => self.path_present(&change.path),
                };
                self.note_outcome(outcome, &mut set_changed, &mut touched);
            }
            if touched {
                if let Err(e) = self.search.commit() {
                    log::warn!("Could not commit the search index: {e}");
                }
            }
            if set_changed {
                if let Err(e) = self.relink_locked(false) {
                    log::warn!("Re-resolving links failed: {e}");
                }
            }
        }
        let payload = FsChangedPayload {
            changes: changes.iter().map(convert::fs_change).collect(),
        };
        self.sink.fs_changed(&payload);
        if touched {
            self.emit_status();
        }
    }

    fn note_outcome(
        &self,
        outcome: Result<Outcome, CoreError>,
        set_changed: &mut bool,
        touched: &mut bool,
    ) {
        match outcome {
            Ok(Outcome::None) => {}
            Ok(Outcome::Updated) => *touched = true,
            Ok(Outcome::SetChanged) => {
                *touched = true;
                *set_changed = true;
            }
            Err(e) => log::warn!("Could not apply an external change: {e}"),
        }
    }

    /// `path` exists (or should): index it, or the notes under it.
    fn path_present(&self, path: &RelPath) -> Result<Outcome, CoreError> {
        let fs = self.vault.fs();
        if fs.is_dir(path) {
            let stale: Vec<RelPath> = {
                let cache = lock(&self.notes);
                fs.walk_notes()
                    .filter(|n| n.path.starts_with(path))
                    .filter(|n| cache.get(n.path.as_str()).map(|c| c.mtime) != Some(n.mtime_ms))
                    .map(|n| n.path)
                    .collect()
            };
            let paths = self.note_paths_with(&stale);
            let resolver = LinkResolver::new(&paths);
            let mut outcome = Outcome::None;
            for rel in &stale {
                let indexed = self.index_file(rel, &resolver)?;
                outcome = outcome.max(if indexed.new {
                    Outcome::SetChanged
                } else {
                    Outcome::Updated
                });
            }
            return Ok(outcome);
        }
        if !path.is_note() {
            return Ok(Outcome::None);
        }
        if !fs.exists(path) {
            return self.path_removed(path);
        }
        let file = fs.read_file(path)?;
        let cached_hash = lock(&self.notes).get(path.as_str()).map(|c| c.hash.clone());
        if cached_hash.as_deref() == Some(file.hash.as_str()) {
            return Ok(Outcome::None);
        }
        let paths = self.note_paths_with(std::slice::from_ref(path));
        let resolver = LinkResolver::new(&paths);
        let indexed =
            self.index_content(path, &file.content, &file.hash, file.mtime_ms, &resolver)?;
        Ok(if indexed.new {
            Outcome::SetChanged
        } else {
            Outcome::Updated
        })
    }

    /// `path` is gone: drop the note, or every note under it.
    fn path_removed(&self, path: &RelPath) -> Result<Outcome, CoreError> {
        let mut removed = false;
        if path.is_note() {
            removed |= self.unindex_note(path.as_str())?;
        }
        let under = !lock(&self.notes).keys_under(path.as_str()).is_empty();
        if under {
            removed |= self.unindex_folder(path.as_str())?;
        }
        Ok(if removed {
            Outcome::SetChanged
        } else {
            Outcome::None
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Outcome {
    None,
    Updated,
    SetChanged,
}
