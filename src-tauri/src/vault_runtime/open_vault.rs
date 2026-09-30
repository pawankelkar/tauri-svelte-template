//! One open vault: its files, DB cache, search index, note cache, watcher
//! and worker, plus the note operations the commands call.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use ostralith_core::CoreError;
use ostralith_index::{quick_open, NoteDoc, QuickOpenCandidate, SearchIndex};
use ostralith_store::key::{self, KeyStore};
use ostralith_store::repo::links as link_repo;
use ostralith_store::{
    Db, Encryption, HeadingRecord, LinkRecord, NoteRecord, StoreError, TaskRecord,
};
use ostralith_sync::GitBackup;
use ostralith_vault::links::{split_target, LinkResolver};
use ostralith_vault::{
    parse_note, rename_with_links, strip_frontmatter, RelPath, Vault, VaultWatcher,
};

use super::worker::{self, Job};
use super::{convert, lock, now_ms, EventSink};
use crate::commands::db::DbStatus;
use crate::commands::search::{IndexStatus, QuickOpenItem, SearchHit};
use crate::commands::vault::{
    Backlink, DbEncryption, LinkTarget, Note, NoteRef, RenameResult, TreeNode, VaultInfo,
    WriteResult,
};

/// The SQLite cache inside `$APPDATA/vaults/<id>/`.
pub const DB_FILE: &str = "index.db";
/// The tantivy index directory inside `$APPDATA/vaults/<id>/`.
pub const SEARCH_DIR: &str = "search";

/// Signature for backup commits when the git config has none.
pub(super) const GIT_AUTHOR_NAME: &str = "Ostralith";
pub(super) const GIT_AUTHOR_EMAIL: &str = "ostralith@localhost";

/// Commit the search index at least this often during a sync.
pub(super) const COMMIT_EVERY: u32 = 200;

/// What the app knows about each indexed note, for quick open, link
/// resolution and change detection without touching SQLite.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct CachedNote {
    pub title: String,
    pub mtime: f64,
    pub hash: String,
}

#[derive(Default)]
pub(super) struct NoteCache {
    notes: BTreeMap<String, CachedNote>,
    paths: Option<Arc<Vec<RelPath>>>,
    candidates: Option<Arc<Vec<QuickOpenCandidate>>>,
}

impl NoteCache {
    /// Returns whether the path is new.
    pub fn insert(&mut self, path: &str, note: CachedNote) -> bool {
        let new = self.notes.insert(path.to_string(), note).is_none();
        if new {
            self.paths = None;
        }
        self.candidates = None;
        new
    }

    pub fn remove(&mut self, path: &str) -> bool {
        let removed = self.notes.remove(path).is_some();
        if removed {
            self.paths = None;
            self.candidates = None;
        }
        removed
    }

    /// Removes every note under `folder/`; returns how many.
    pub fn remove_prefix(&mut self, folder: &str) -> usize {
        let keys = self.keys_under(folder);
        for key in &keys {
            self.notes.remove(key);
        }
        if !keys.is_empty() {
            self.paths = None;
            self.candidates = None;
        }
        keys.len()
    }

    pub fn keys_under(&self, folder: &str) -> Vec<String> {
        let prefix = format!("{}/", folder.trim_end_matches('/'));
        self.notes
            .range(prefix.clone()..)
            .take_while(|(k, _)| k.starts_with(&prefix))
            .map(|(k, _)| k.clone())
            .collect()
    }

    pub fn get(&self, path: &str) -> Option<&CachedNote> {
        self.notes.get(path)
    }

    pub fn len(&self) -> usize {
        self.notes.len()
    }

    pub fn clear(&mut self) {
        *self = Self::default();
    }

    /// Every note path, sorted.
    pub fn paths(&mut self) -> Arc<Vec<RelPath>> {
        if let Some(paths) = &self.paths {
            return paths.clone();
        }
        let paths: Arc<Vec<RelPath>> = Arc::new(
            self.notes
                .keys()
                .filter_map(|p| RelPath::new(p.as_str()).ok())
                .collect(),
        );
        self.paths = Some(paths.clone());
        paths
    }

    pub fn candidates(&mut self) -> Arc<Vec<QuickOpenCandidate>> {
        if let Some(c) = &self.candidates {
            return c.clone();
        }
        let c: Arc<Vec<QuickOpenCandidate>> = Arc::new(
            self.notes
                .iter()
                .map(|(path, n)| QuickOpenCandidate {
                    path: path.clone(),
                    title: n.title.clone(),
                    mtime: n.mtime,
                })
                .collect(),
        );
        self.candidates = Some(c.clone());
        c
    }
}

/// Shared progress counters behind `index_status`.
#[derive(Default)]
pub(super) struct Progress {
    pub indexing: AtomicBool,
    pub done: AtomicU32,
    pub total: AtomicU32,
}

pub struct OpenVault {
    info: VaultInfo,
    pub(super) vault: Vault,
    pub(super) db: Db,
    pub(super) search: SearchIndex,
    integrity_ok: AtomicBool,
    pub(super) notes: Mutex<NoteCache>,
    pub(super) git: Mutex<Option<GitBackup>>,
    pub(super) progress: Progress,
    /// Set by `shutdown`; long jobs stop early.
    pub(super) cancel: AtomicBool,
    /// Set while a `Relink` job is queued, so bursts coalesce.
    pub(super) relink_queued: AtomicBool,
    /// Held for every DB + search mutation (see the module docs).
    pub(super) index_lock: Mutex<()>,
    watcher: Mutex<Option<VaultWatcher>>,
    jobs: Mutex<Option<Sender<Job>>>,
    worker: Mutex<Option<JoinHandle<()>>>,
    pub(super) sink: Arc<dyn EventSink>,
}

impl std::fmt::Debug for OpenVault {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("OpenVault")
            .field("info", &self.info)
            .finish_non_exhaustive()
    }
}

/// Result of indexing one note.
pub(super) struct Indexed {
    pub title: String,
    pub new: bool,
}

impl OpenVault {
    /// Opens the DB (recovering from corruption or a key mismatch) and the
    /// search index in `data_dir`, starts the worker and the watcher, and
    /// queues the initial sync (a full rebuild if either store was reset).
    pub(super) fn open(
        vault: Vault,
        encryption: DbEncryption,
        data_dir: &Path,
        key_store: &KeyStore,
        sink: Arc<dyn EventSink>,
    ) -> Result<Arc<Self>, CoreError> {
        fs::create_dir_all(data_dir)
            .map_err(|e| CoreError::from(format!("Creating {}: {e}", data_dir.display())))?;
        let (db, db_reset) = open_db(&data_dir.join(DB_FILE), encryption, vault.id(), key_store)?;
        let search = open_search(&data_dir.join(SEARCH_DIR))?;
        let full = db_reset || search.needs_rebuild();

        let git = match GitBackup::open(vault.root()) {
            Ok(git) => git.map(|g| g.with_signature(GIT_AUTHOR_NAME, GIT_AUTHOR_EMAIL)),
            Err(e) => {
                log::warn!("Git backup unavailable: {e}");
                None
            }
        };

        let mut cache = NoteCache::default();
        if !full {
            for meta in db.list_all_meta()? {
                cache.insert(
                    &meta.path,
                    CachedNote {
                        title: meta.title,
                        mtime: meta.mtime,
                        hash: meta.hash,
                    },
                );
            }
        }

        let info = VaultInfo {
            id: vault.id().to_string(),
            name: vault.name(),
            path: vault.root().display().to_string(),
            encryption,
            last_opened_at: now_ms(),
        };
        let opened = Arc::new(Self {
            info,
            vault,
            db,
            search,
            integrity_ok: AtomicBool::new(true),
            notes: Mutex::new(cache),
            git: Mutex::new(git),
            progress: Progress::default(),
            cancel: AtomicBool::new(false),
            relink_queued: AtomicBool::new(false),
            index_lock: Mutex::new(()),
            watcher: Mutex::new(None),
            jobs: Mutex::new(None),
            worker: Mutex::new(None),
            sink,
        });

        let (tx, rx) = mpsc::channel();
        let weak = Arc::downgrade(&opened);
        let handle = std::thread::Builder::new()
            .name(format!("vault-indexer-{}", opened.info.id))
            .spawn(move || worker::run(weak, rx))
            .map_err(|e| CoreError::from(format!("Starting the indexer: {e}")))?;
        *lock(&opened.worker) = Some(handle);

        let watch_tx = tx.clone();
        match opened.vault.watch(move |changes| {
            let _ = watch_tx.send(Job::FsChanges(changes));
        }) {
            Ok(watcher) => *lock(&opened.watcher) = Some(watcher),
            Err(e) => log::warn!("Not watching {}: {e}", opened.info.path),
        }
        *lock(&opened.jobs) = Some(tx);

        opened.progress.indexing.store(true, Ordering::SeqCst);
        opened.send(Job::Sync { full });
        Ok(opened)
    }

    pub fn info(&self) -> &VaultInfo {
        &self.info
    }

    pub fn encryption(&self) -> DbEncryption {
        self.info.encryption
    }

    /// Stops the watcher (first, so no new changes arrive) and the worker,
    /// then commits whatever the search index has staged. Must not be
    /// called from the worker thread.
    pub fn shutdown(&self) {
        self.cancel.store(true, Ordering::SeqCst);
        drop(lock(&self.watcher).take());
        drop(lock(&self.jobs).take());
        let handle = lock(&self.worker).take();
        if let Some(handle) = handle {
            if handle.thread().id() != std::thread::current().id() && handle.join().is_err() {
                log::warn!("The indexer thread panicked");
            }
        }
        let _guard = lock(&self.index_lock);
        if let Err(e) = self.search.commit() {
            log::warn!("Could not commit the search index on close: {e}");
        }
    }

    pub(super) fn send(&self, job: Job) {
        if let Some(tx) = lock(&self.jobs).as_ref() {
            let _ = tx.send(job);
        }
    }

    /// Queues a background re-resolution of every link (coalesced).
    pub(super) fn queue_relink(&self) {
        if !self.relink_queued.swap(true, Ordering::SeqCst) {
            self.send(Job::Relink);
        }
    }

    /// Waits until every job queued so far has run. For tests.
    #[cfg(test)]
    pub(crate) fn flush(&self) {
        let (tx, rx) = mpsc::channel();
        self.send(Job::Barrier(tx));
        let _ = rx.recv_timeout(Duration::from_secs(30));
    }

    // --- Status -----------------------------------------------------------

    pub fn index_status(&self) -> IndexStatus {
        IndexStatus {
            indexing: self.progress.indexing.load(Ordering::SeqCst),
            done: self.progress.done.load(Ordering::SeqCst),
            total: self.progress.total.load(Ordering::SeqCst),
            note_count: lock(&self.notes).len() as u32,
        }
    }

    pub(super) fn emit_status(&self) {
        self.sink.index_status(self.index_status());
    }

    pub fn db_status(&self) -> Result<DbStatus, CoreError> {
        let stats = self.db.stats()?;
        Ok(DbStatus {
            encryption: self.encryption(),
            size_bytes: stats.size_bytes as f64,
            schema_version: stats.schema_version,
            note_count: stats.note_count,
            integrity_ok: self.integrity_ok.load(Ordering::SeqCst),
        })
    }

    /// Starts a full rebuild in the background.
    pub fn reindex(&self) {
        self.progress.indexing.store(true, Ordering::SeqCst);
        self.send(Job::Sync { full: true });
    }

    // --- Indexing primitives (caller holds `index_lock`) --------------------

    /// Note paths from the cache plus `extra`, sorted, for a resolver.
    pub(super) fn note_paths_with(&self, extra: &[RelPath]) -> Arc<Vec<RelPath>> {
        let base = lock(&self.notes).paths();
        if extra.iter().all(|p| base.binary_search(p).is_ok()) {
            return base;
        }
        let mut paths = (*base).clone();
        for p in extra {
            if let Err(i) = paths.binary_search(p) {
                paths.insert(i, p.clone());
            }
        }
        Arc::new(paths)
    }

    /// Parses `content` and writes it to the DB, the search index (staged)
    /// and the cache.
    pub(super) fn index_content(
        &self,
        rel: &RelPath,
        content: &str,
        hash: &str,
        mtime: f64,
        resolver: &LinkResolver<'_>,
    ) -> Result<Indexed, CoreError> {
        let parsed = parse_note(content);
        let title = note_title(parsed.title.as_deref(), rel);
        let record = NoteRecord {
            path: rel.to_string(),
            title: title.clone(),
            hash: hash.to_string(),
            mtime,
            size: content.len() as u64,
            frontmatter: parsed.frontmatter.as_ref().map(|v| v.to_string()),
        };
        let links: Vec<LinkRecord> = parsed
            .links
            .iter()
            // Same-note links (`[[#Heading]]`) are navigation, not backlinks.
            .filter(|link| !link.target.is_empty())
            .map(|link| LinkRecord {
                target_raw: link.target.clone(),
                target_path: resolver.resolve_link(link, rel).map(ToString::to_string),
                heading: link.heading.clone(),
                alias: link.alias.clone(),
                is_embed: link.is_embed,
                line: link.line,
                context: link.context.clone(),
            })
            .collect();
        let headings: Vec<HeadingRecord> = parsed
            .headings
            .iter()
            .map(|h| HeadingRecord {
                level: h.level,
                text: h.text.clone(),
                slug: h.slug.clone(),
                line: h.line,
            })
            .collect();
        let tasks: Vec<TaskRecord> = parsed
            .tasks
            .iter()
            .map(|t| TaskRecord {
                line: t.line,
                text: t.text.clone(),
                done: t.done,
            })
            .collect();
        self.db
            .index_note(&record, &links, &parsed.tags, &headings, &tasks)?;
        self.search.upsert(&NoteDoc {
            path: rel.to_string(),
            title: title.clone(),
            headings: parsed.headings.iter().map(|h| h.text.clone()).collect(),
            body: strip_frontmatter(content).to_string(),
            tags: parsed.tags.clone(),
            mtime,
        })?;
        let new = lock(&self.notes).insert(
            rel.as_str(),
            CachedNote {
                title: title.clone(),
                mtime,
                hash: hash.to_string(),
            },
        );
        Ok(Indexed { title, new })
    }

    /// Reads `rel` from disk and indexes it.
    pub(super) fn index_file(
        &self,
        rel: &RelPath,
        resolver: &LinkResolver<'_>,
    ) -> Result<Indexed, CoreError> {
        let file = self.vault.fs().read_file(rel)?;
        self.index_content(rel, &file.content, &file.hash, file.mtime_ms, resolver)
    }

    /// Drops one note from the DB, search (staged) and cache.
    pub(super) fn unindex_note(&self, path: &str) -> Result<bool, CoreError> {
        let in_db = self.db.remove_note(path)?;
        self.search.remove(path)?;
        let in_cache = lock(&self.notes).remove(path);
        Ok(in_db || in_cache)
    }

    /// Drops every note under `folder`; returns whether there were any.
    pub(super) fn unindex_folder(&self, folder: &str) -> Result<bool, CoreError> {
        let in_db = self.db.remove_folder(folder)?;
        self.search.remove_prefix(folder)?;
        let in_cache = lock(&self.notes).remove_prefix(folder);
        Ok(in_db > 0 || in_cache > 0)
    }

    /// Re-resolves stored links against the current note set. With
    /// `unresolved_only`, only links that point nowhere are tried (cheap,
    /// done synchronously after a note appears); otherwise every link is
    /// re-checked (done in the background after the note set changed,
    /// since a new note can also win an existing basename match).
    ///
    /// The DB doesn't store whether a link was a wikilink or a markdown
    /// link, so a link keeps its target if either rule still yields it,
    /// and otherwise takes the wikilink answer, else the markdown one.
    pub(super) fn relink_locked(&self, unresolved_only: bool) -> Result<usize, CoreError> {
        let paths = self.note_paths_with(&[]);
        let resolver = LinkResolver::new(&paths);
        let rows = self
            .db
            .read(|conn| link_repo::targets(conn, unresolved_only))?;
        let mut updates: Vec<(i64, Option<String>)> = Vec::new();
        for row in rows {
            if self.cancel.load(Ordering::Relaxed) {
                break;
            }
            let Ok(from) = RelPath::new(row.source_path.as_str()) else {
                continue;
            };
            let wiki = resolver
                .resolve(&row.target_raw, &from)
                .map(RelPath::as_str);
            let markdown = resolver
                .resolve_markdown(&row.target_raw, &from)
                .map(RelPath::as_str);
            let current = row.target_path.as_deref();
            let keep = current.is_some() && (current == wiki || current == markdown);
            let next = if keep { current } else { wiki.or(markdown) };
            if next != current {
                updates.push((row.id, next.map(str::to_string)));
            }
        }
        if !updates.is_empty() {
            self.db.write(|tx| {
                for (id, target) in &updates {
                    link_repo::set_target_by_id(tx, *id, target.as_deref())?;
                }
                Ok(())
            })?;
        }
        Ok(updates.len())
    }

    pub(super) fn relink(&self, unresolved_only: bool) -> Result<usize, CoreError> {
        let _guard = lock(&self.index_lock);
        self.relink_locked(unresolved_only)
    }

    /// After a note appeared: link unresolved references now, re-check the
    /// rest in the background.
    fn after_note_added(&self) {
        if let Err(e) = self.relink_locked(true) {
            log::warn!("Could not resolve pending links: {e}");
        }
        self.queue_relink();
    }

    // --- Commands ---------------------------------------------------------

    pub fn list_tree(&self) -> Result<Vec<TreeNode>, CoreError> {
        Ok(self
            .vault
            .fs()
            .list_tree()?
            .into_iter()
            .map(convert::tree_node)
            .collect())
    }

    pub fn read_note(&self, path: &str) -> Result<Note, CoreError> {
        let rel = RelPath::new(path)?;
        let file = self.vault.fs().read_file(&rel)?;
        let parsed = parse_note(&file.content);
        Ok(Note {
            path: rel.to_string(),
            title: note_title(parsed.title.as_deref(), &rel),
            content: file.content,
            frontmatter: parsed.frontmatter,
            mtime: file.mtime_ms,
            hash: file.hash,
        })
    }

    /// Atomic write, then a synchronous reindex of the note (DB + search +
    /// commit) so search and backlinks reflect it when this returns.
    pub fn write_note(
        &self,
        path: &str,
        content: &str,
        expected_hash: Option<&str>,
    ) -> Result<WriteResult, CoreError> {
        let rel = RelPath::new(path)?;
        let _guard = lock(&self.index_lock);
        let outcome = self.vault.fs().write_atomic(&rel, content, expected_hash)?;
        if rel.is_note() {
            let paths = self.note_paths_with(std::slice::from_ref(&rel));
            let resolver = LinkResolver::new(&paths);
            let indexed =
                self.index_content(&rel, content, &outcome.hash, outcome.mtime_ms, &resolver)?;
            self.search.commit()?;
            if indexed.new {
                self.after_note_added();
            }
        }
        Ok(WriteResult {
            path: rel.into_string(),
            mtime: outcome.mtime_ms,
            hash: outcome.hash,
        })
    }

    pub fn create_note(
        &self,
        folder: Option<&str>,
        title: Option<&str>,
    ) -> Result<NoteRef, CoreError> {
        let folder = match folder.map(str::trim).filter(|f| !f.is_empty()) {
            Some(f) => Some(RelPath::new(f.trim_matches('/'))?),
            None => None,
        };
        let title = title.map(str::trim).filter(|t| !t.is_empty());
        let content = title.map(|t| format!("# {t}\n\n")).unwrap_or_default();
        let _guard = lock(&self.index_lock);
        let (rel, outcome) = self.vault.fs().create_unique_note_with(
            folder.as_ref(),
            title.unwrap_or("Untitled"),
            &content,
        )?;
        let paths = self.note_paths_with(std::slice::from_ref(&rel));
        let resolver = LinkResolver::new(&paths);
        let indexed =
            self.index_content(&rel, &content, &outcome.hash, outcome.mtime_ms, &resolver)?;
        self.search.commit()?;
        self.after_note_added();
        Ok(NoteRef {
            path: rel.into_string(),
            title: indexed.title,
        })
    }

    pub fn create_folder(&self, path: &str) -> Result<(), CoreError> {
        let rel = RelPath::new(path)?;
        self.vault.fs().create_dir(&rel)?;
        Ok(())
    }

    /// Renames on disk (rewriting inbound links), then moves the DB rows,
    /// reindexes the moved notes and every note whose links were rewritten,
    /// and re-checks all links in the background.
    pub fn rename_path(&self, from: &str, to: &str) -> Result<RenameResult, CoreError> {
        let from = RelPath::new(from)?;
        let to = RelPath::new(to)?;
        let fs = self.vault.fs();
        let _guard = lock(&self.index_lock);
        if !fs.exists(&from) {
            return Err(CoreError::not_found(from.into_string()));
        }
        let is_dir = fs.is_dir(&from);
        let report = rename_with_links(fs, &from, &to)?;

        let mut moved: Vec<RelPath> = Vec::new();
        if is_dir {
            self.db.rename_folder(from.as_str(), to.as_str())?;
            self.search.remove_prefix(from.as_str())?;
            lock(&self.notes).remove_prefix(from.as_str());
            moved.extend(
                fs.walk_notes()
                    .map(|n| n.path)
                    .filter(|p| p.starts_with(&to)),
            );
        } else {
            if from.is_note() {
                if to.is_note() {
                    self.db.rename_note(from.as_str(), to.as_str())?;
                } else {
                    self.db.remove_note(from.as_str())?;
                }
                self.search.remove(from.as_str())?;
                lock(&self.notes).remove(from.as_str());
            }
            if to.is_note() {
                moved.push(to.clone());
            }
        }

        let mut touched = moved.clone();
        for path in &report.updated_paths {
            if path.is_note() && !touched.contains(path) {
                touched.push(path.clone());
            }
        }
        let paths = self.note_paths_with(&moved);
        let resolver = LinkResolver::new(&paths);
        for path in &touched {
            if let Err(e) = self.index_file(path, &resolver) {
                log::warn!("rename: could not reindex {path}: {e}");
            }
        }
        self.search.commit()?;
        if let Err(e) = self.relink_locked(true) {
            log::warn!("rename: could not resolve pending links: {e}");
        }
        self.queue_relink();
        Ok(RenameResult {
            path: report.new_path.into_string(),
            updated_links: report.updated_links,
            updated_files: report.updated_files,
        })
    }

    /// Moves into `.trash/` and drops the note(s) from the DB and search.
    pub fn trash_path(&self, path: &str) -> Result<(), CoreError> {
        let rel = RelPath::new(path)?;
        let fs = self.vault.fs();
        let _guard = lock(&self.index_lock);
        let is_dir = fs.is_dir(&rel);
        fs.trash(&rel)?;
        if is_dir {
            self.unindex_folder(rel.as_str())?;
        } else if rel.is_note() {
            self.unindex_note(rel.as_str())?;
        }
        self.search.commit()?;
        self.queue_relink();
        Ok(())
    }

    pub fn backlinks(&self, path: &str) -> Result<Vec<Backlink>, CoreError> {
        let rel = RelPath::new(path)?;
        Ok(self
            .db
            .backlinks(rel.as_str())?
            .into_iter()
            .map(convert::backlink)
            .collect())
    }

    /// Obsidian resolution against the indexed notes. An unresolved target
    /// reports the path a new note would get (`<target>.md` unless it has
    /// an extension); a non-note target (`image.png`) that exists on disk
    /// relative to the vault or the note's folder counts as existing.
    pub fn resolve_link(&self, from_path: &str, target: &str) -> Result<LinkTarget, CoreError> {
        let parts = split_target(target);
        if parts.target.is_empty() {
            return Ok(LinkTarget {
                raw: target.to_string(),
                path: Some(from_path.to_string()),
                heading: parts.heading,
                exists: true,
            });
        }
        let from = RelPath::new(from_path)?;
        let paths = self.note_paths_with(&[]);
        let resolver = LinkResolver::new(&paths);
        if let Some(found) = resolver.resolve(&parts.target, &from) {
            return Ok(LinkTarget {
                raw: target.to_string(),
                path: Some(found.to_string()),
                heading: parts.heading,
                exists: true,
            });
        }
        let wanted = parts.target.trim().trim_start_matches('/');
        let has_extension = has_extension(wanted);
        let candidate = if has_extension {
            wanted.to_string()
        } else {
            format!("{wanted}.md")
        };
        let fs = self.vault.fs();
        if has_extension {
            let relative = from
                .parent()
                .and_then(|dir| dir.join(wanted).ok())
                .filter(|p| fs.exists(p) && !fs.is_dir(p));
            let absolute = RelPath::new(wanted.to_string())
                .ok()
                .filter(|p| fs.exists(p) && !fs.is_dir(p));
            if let Some(found) = relative.or(absolute) {
                return Ok(LinkTarget {
                    raw: target.to_string(),
                    path: Some(found.into_string()),
                    heading: parts.heading,
                    exists: true,
                });
            }
        }
        Ok(LinkTarget {
            raw: target.to_string(),
            path: RelPath::new(candidate).ok().map(RelPath::into_string),
            heading: parts.heading,
            exists: false,
        })
    }

    pub fn quick_open(&self, query: &str, limit: u32) -> Vec<QuickOpenItem> {
        let candidates = lock(&self.notes).candidates();
        quick_open::rank(query, &candidates, limit as usize)
            .into_iter()
            .map(|m| QuickOpenItem {
                path: m.path,
                title: m.title,
                score: m.score,
                title_parts: convert::text_parts(m.title_parts),
                path_parts: convert::text_parts(m.path_parts),
            })
            .collect()
    }

    pub fn search(&self, query: &str, limit: u32) -> Result<Vec<SearchHit>, CoreError> {
        Ok(self
            .search
            .search(query, limit as usize)?
            .into_iter()
            .map(|hit| SearchHit {
                path: hit.path,
                title: hit.title,
                score: hit.score,
                snippet: convert::text_parts(hit.snippet),
            })
            .collect())
    }
}

/// Frontmatter `title` or first H1, else the file stem.
pub(super) fn note_title(parsed: Option<&str>, rel: &RelPath) -> String {
    parsed
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| rel.file_stem().to_string())
}

/// Same rule as the browser preview: a 1–8 character alphanumeric suffix.
fn has_extension(target: &str) -> bool {
    let name = target.rsplit('/').next().unwrap_or(target);
    match name.rsplit_once('.') {
        Some((stem, ext)) => {
            !stem.is_empty()
                && (1..=8).contains(&ext.len())
                && ext.chars().all(|c| c.is_ascii_alphanumeric())
        }
        None => false,
    }
}

/// Opens (or recreates) the DB. Returns whether it started empty because
/// the old file was unusable, in which case the vault needs a full reindex.
fn open_db(
    path: &Path,
    encryption: DbEncryption,
    vault_id: &str,
    key_store: &KeyStore,
) -> Result<(Db, bool), CoreError> {
    let key = match encryption {
        DbEncryption::None => Encryption::None,
        DbEncryption::Keychain => Encryption::Key(key::load_or_create_key(key_store, vault_id)?),
    };
    match Db::open_or_recover(path, key.clone()) {
        Ok(outcome) => {
            let recovered = outcome.recovered();
            if let Some(moved) = &outcome.recovered_from {
                log::warn!("Index DB was unusable; moved to {}", moved.display());
            }
            Ok((outcome.db, recovered))
        }
        // The cache is disposable: a DB we can't unlock with this key (key
        // lost, or the encryption setting changed) is moved aside and
        // rebuilt from the vault.
        Err(e @ (StoreError::WrongKey | StoreError::NotEncrypted)) => {
            log::warn!(
                "Index DB at {} can't be opened ({e}); rebuilding",
                path.display()
            );
            move_aside(path, "mismatch");
            Ok((Db::open(path, key)?, true))
        }
        Err(e) => Err(e.into()),
    }
}

/// Renames `path` and its WAL/SHM siblings to `<name>.<tag>-<unix ms>`.
fn move_aside(path: &Path, tag: &str) {
    let stamp = now_ms() as u64;
    for suffix in ["", "-wal", "-shm"] {
        let mut from = path.as_os_str().to_owned();
        from.push(suffix);
        let from = std::path::PathBuf::from(from);
        if from.exists() {
            let mut to = from.as_os_str().to_owned();
            to.push(format!(".{tag}-{stamp}"));
            if let Err(e) = fs::rename(&from, &to) {
                log::warn!("Could not move {} aside: {e}", from.display());
            }
        }
    }
}

/// Opens the search index, waiting briefly for a previous instance of the
/// same vault (just closed) to release tantivy's writer lock.
fn open_search(dir: &Path) -> Result<SearchIndex, CoreError> {
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        match SearchIndex::open(dir) {
            Ok(index) => return Ok(index),
            Err(e)
                if Instant::now() < deadline && e.to_string().to_lowercase().contains("lock") =>
            {
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(e.into()),
        }
    }
}
