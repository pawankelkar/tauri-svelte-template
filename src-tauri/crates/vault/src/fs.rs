use std::cmp::Ordering;
use std::fs::{self, Metadata, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::error::{VaultError, VaultResult};
use crate::path::RelPath;
use crate::recent::{Expected, RecentWrites};
use crate::sort::natural_cmp;

/// Folder for vault metadata (marker, caches). Hidden from the tree.
pub const META_DIR: &str = ".ostralith";
/// Where [`VaultFs::trash`] moves things. Hidden from the tree.
pub const TRASH_DIR: &str = ".trash";
/// Prefix of the temp files `write_atomic` creates next to the target.
pub const TMP_PREFIX: &str = ".ostralith-tmp-";

/// Top-level folders the vault manages itself; public ops refuse them.
const RESERVED_ROOTS: [&str; 3] = [META_DIR, ".git", TRASH_DIR];

/// blake3 hex digest of `bytes`: the hash used for conflict detection.
pub fn hash_bytes(bytes: impl AsRef<[u8]>) -> String {
    blake3::hash(bytes.as_ref()).to_hex().to_string()
}

/// True for names the tree, walker and watcher skip: dotfiles/dot-folders
/// (`.ostralith`, `.git`, `.trash`, temp files) and iCloud placeholders.
pub fn is_hidden_name(name: &str) -> bool {
    name.starts_with('.') || name.ends_with(".icloud")
}

/// Milliseconds since the Unix epoch, as `f64` for IPC.
pub(crate) fn mtime_ms(meta: &Metadata) -> f64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64() * 1000.0)
        .map(f64::floor)
        .unwrap_or(0.0)
}

/// Result of a successful write.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteOutcome {
    /// blake3 hex of the bytes now on disk.
    pub hash: String,
    pub mtime_ms: f64,
}

/// A file read together with the hash callers hand back to `write_atomic`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    pub content: String,
    pub hash: String,
    pub mtime_ms: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EntryKind {
    Folder,
    /// `*.md`
    Note,
    /// Anything else shown in the tree.
    File,
}

/// One node of [`VaultFs::list_tree`]. `children` is empty unless `Folder`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeEntry {
    pub path: RelPath,
    pub name: String,
    pub kind: EntryKind,
    pub mtime: f64,
    pub children: Vec<TreeEntry>,
}

/// A note found by [`VaultFs::walk_notes`].
#[derive(Debug, Clone, PartialEq)]
pub struct NoteEntry {
    pub path: RelPath,
    pub mtime_ms: f64,
    pub size: f64,
}

/// Path-safe file operations inside one vault.
///
/// Every public method takes a [`RelPath`], resolves it against the
/// canonicalised root and verifies, after canonicalising the deepest existing
/// ancestor, that the result is still inside the root, so a symlink cannot
/// lead a write out of the vault. Cheap to clone.
#[derive(Debug, Clone)]
pub struct VaultFs {
    root: Arc<PathBuf>,
    recent: RecentWrites,
}

impl VaultFs {
    /// Opens `root` (must be an existing directory) with a fresh
    /// [`RecentWrites`] set.
    pub fn new(root: impl AsRef<Path>) -> VaultResult<Self> {
        Self::with_recent_writes(root, RecentWrites::default())
    }

    pub fn with_recent_writes(root: impl AsRef<Path>, recent: RecentWrites) -> VaultResult<Self> {
        let root = root.as_ref();
        let display = root.to_string_lossy().to_string();
        let canonical =
            fs::canonicalize(root).map_err(|e| VaultError::io(&display, "opening vault", e))?;
        if !canonical.is_dir() {
            return Err(VaultError::invalid_input(format!(
                "{display} is not a folder"
            )));
        }
        Ok(Self {
            root: Arc::new(canonical),
            recent,
        })
    }

    /// The canonicalised vault root.
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// The own-write set shared with the watcher.
    pub fn recent_writes(&self) -> &RecentWrites {
        &self.recent
    }

    /// Maps an absolute path inside the vault back to a [`RelPath`].
    pub fn to_rel(&self, abs: &Path) -> Option<RelPath> {
        let rel = abs.strip_prefix(&*self.root).ok()?;
        RelPath::from_os_relative(rel).ok()
    }

    /// Absolute, containment-checked location of `rel`. Existing symlinks
    /// are followed (and must stay inside the vault).
    pub fn abs_path(&self, rel: &RelPath) -> VaultResult<PathBuf> {
        self.resolve(rel)
    }

    // ---- resolution ------------------------------------------------------

    fn guard(&self, rel: &RelPath) -> VaultResult<()> {
        let first = rel.segments().next().unwrap_or_default();
        if RESERVED_ROOTS
            .iter()
            .any(|reserved| reserved.eq_ignore_ascii_case(first))
        {
            return Err(VaultError::invalid_path(
                rel.as_str(),
                "reserved vault folder",
            ));
        }
        Ok(())
    }

    fn lexical(&self, rel: &RelPath) -> PathBuf {
        let mut path = self.root.to_path_buf();
        for segment in rel.segments() {
            path.push(segment);
        }
        path
    }

    fn check_inside(&self, rel: &str, canonical: &Path) -> VaultResult<()> {
        if canonical.starts_with(&*self.root) {
            Ok(())
        } else {
            Err(VaultError::outside(rel))
        }
    }

    /// Canonicalises the deepest existing prefix of `rel` (following
    /// symlinks), checks containment, and re-appends the missing tail.
    fn resolve(&self, rel: &RelPath) -> VaultResult<PathBuf> {
        let full = self.lexical(rel);
        let mut existing = full.as_path();
        let mut tail = Vec::new();
        while fs::symlink_metadata(existing).is_err() {
            match (existing.file_name(), existing.parent()) {
                (Some(name), Some(parent)) if existing != self.root.as_path() => {
                    tail.push(name.to_os_string());
                    existing = parent;
                }
                _ => break,
            }
        }
        // A dangling symlink canonicalises to an error: treat as escaping,
        // since we can't prove where it points.
        let canonical =
            fs::canonicalize(existing).map_err(|_| VaultError::outside(rel.as_str()))?;
        self.check_inside(rel.as_str(), &canonical)?;
        let mut out = canonical;
        for name in tail.into_iter().rev() {
            out.push(name);
        }
        Ok(out)
    }

    /// Like [`Self::resolve`] but does not follow a symlink in the last
    /// segment: used to move or trash the entry itself.
    fn resolve_entry(&self, rel: &RelPath) -> VaultResult<PathBuf> {
        let parent = match rel.parent() {
            Some(parent) => self.resolve(&parent)?,
            None => self.root.to_path_buf(),
        };
        Ok(parent.join(rel.file_name()))
    }

    // ---- reads -----------------------------------------------------------

    pub fn exists(&self, rel: &RelPath) -> bool {
        self.resolve(rel).is_ok_and(|p| p.exists())
    }

    pub fn is_dir(&self, rel: &RelPath) -> bool {
        self.resolve(rel).is_ok_and(|p| p.is_dir())
    }

    pub fn read(&self, rel: &RelPath) -> VaultResult<Vec<u8>> {
        self.guard(rel)?;
        let path = self.resolve(rel)?;
        fs::read(&path).map_err(|e| VaultError::io(rel.as_str(), "reading", e))
    }

    pub fn read_to_string(&self, rel: &RelPath) -> VaultResult<String> {
        let bytes = self.read(rel)?;
        String::from_utf8(bytes)
            .map_err(|_| VaultError::invalid_input(format!("{rel} is not valid UTF-8")))
    }

    /// Content + hash + mtime in one go (what `read_note` needs).
    pub fn read_file(&self, rel: &RelPath) -> VaultResult<FileContent> {
        self.guard(rel)?;
        let path = self.resolve(rel)?;
        let bytes = fs::read(&path).map_err(|e| VaultError::io(rel.as_str(), "reading", e))?;
        let meta = fs::metadata(&path).map_err(|e| VaultError::io(rel.as_str(), "reading", e))?;
        let hash = hash_bytes(&bytes);
        let content = String::from_utf8(bytes)
            .map_err(|_| VaultError::invalid_input(format!("{rel} is not valid UTF-8")))?;
        Ok(FileContent {
            content,
            hash,
            mtime_ms: mtime_ms(&meta),
        })
    }

    pub fn mtime_ms(&self, rel: &RelPath) -> VaultResult<f64> {
        let path = self.resolve(rel)?;
        let meta = fs::metadata(&path).map_err(|e| VaultError::io(rel.as_str(), "reading", e))?;
        Ok(mtime_ms(&meta))
    }

    // ---- writes ----------------------------------------------------------

    /// Atomically replaces `rel` with `content`: temp file in the same
    /// folder, fsync, rename. With `expected_hash`, fails with `Conflict`
    /// when the current file's hash differs (or the file is gone). Creates
    /// missing parent folders. Records the write so the watcher ignores it.
    pub fn write_atomic(
        &self,
        rel: &RelPath,
        content: impl AsRef<[u8]>,
        expected_hash: Option<&str>,
    ) -> VaultResult<WriteOutcome> {
        self.guard(rel)?;
        let content = content.as_ref();
        let path = self.resolve(rel)?;
        let existing = fs::metadata(&path).ok();
        if existing.as_ref().is_some_and(|m| m.is_dir()) {
            return Err(VaultError::invalid_input(format!("{rel} is a folder")));
        }
        if let Some(expected) = expected_hash {
            let current = match fs::read(&path) {
                Ok(bytes) => Some(hash_bytes(bytes)),
                Err(e) if e.kind() == io::ErrorKind::NotFound => None,
                Err(e) => return Err(VaultError::io(rel.as_str(), "reading", e)),
            };
            if current.as_deref() != Some(expected) {
                return Err(VaultError::Conflict {
                    path: rel.to_string(),
                });
            }
        }
        let parent = path
            .parent()
            .ok_or_else(|| VaultError::outside(rel.as_str()))?;
        self.record_new_dirs(rel.parent());
        fs::create_dir_all(parent)
            .map_err(|e| VaultError::io(rel.as_str(), "creating folder", e))?;

        let hash = hash_bytes(content);
        let tmp = parent.join(format!("{TMP_PREFIX}{}", uuid::Uuid::new_v4().simple()));
        let write_tmp = || -> io::Result<()> {
            let mut file = OpenOptions::new().write(true).create_new(true).open(&tmp)?;
            file.write_all(content)?;
            if let Some(meta) = &existing {
                let _ = fs::set_permissions(&tmp, meta.permissions());
            }
            file.sync_all()
        };
        if let Err(e) = write_tmp() {
            let _ = fs::remove_file(&tmp);
            return Err(VaultError::io(rel.as_str(), "writing", e));
        }

        // Record before the rename so the watcher can't see the new file
        // before it knows the write is ours. Also record the resolved
        // location, which differs when `rel` is a symlink.
        self.recent
            .record(rel.as_str(), Expected::Content(hash.clone()));
        if let Some(target) = self.to_rel(&path) {
            if &target != rel {
                self.recent
                    .record(target.as_str(), Expected::Content(hash.clone()));
            }
        }

        if let Err(e) = fs::rename(&tmp, &path) {
            let _ = fs::remove_file(&tmp);
            return Err(VaultError::io(rel.as_str(), "replacing", e));
        }
        sync_dir(parent);
        let meta = fs::metadata(&path).map_err(|e| VaultError::io(rel.as_str(), "reading", e))?;
        Ok(WriteOutcome {
            hash,
            mtime_ms: mtime_ms(&meta),
        })
    }

    /// Creates a folder (and missing parents). `AlreadyExists` if it exists.
    pub fn create_dir(&self, rel: &RelPath) -> VaultResult<()> {
        self.guard(rel)?;
        let path = self.resolve(rel)?;
        if fs::symlink_metadata(&path).is_ok() {
            return Err(VaultError::AlreadyExists {
                path: rel.to_string(),
            });
        }
        self.record_new_dirs(Some(rel.clone()));
        fs::create_dir_all(&path).map_err(|e| VaultError::io(rel.as_str(), "creating folder", e))
    }

    /// Records `folder` and each missing ancestor as an own `Dir` so the
    /// watcher ignores folders created on the way to a write.
    fn record_new_dirs(&self, mut folder: Option<RelPath>) {
        while let Some(dir) = folder {
            if fs::symlink_metadata(self.lexical(&dir)).is_ok() {
                break;
            }
            self.recent.record(dir.as_str(), Expected::Dir);
            folder = dir.parent();
        }
    }

    /// Creates an empty note named `<base_title>.md` in `folder` (vault root
    /// when `None`), or `<base_title> 1.md`, `<base_title> 2.md`, … if taken.
    /// An empty or unusable title becomes `Untitled`.
    pub fn create_unique_note(
        &self,
        folder: Option<&RelPath>,
        base_title: &str,
    ) -> VaultResult<RelPath> {
        self.create_unique_note_with(folder, base_title, "")
            .map(|(path, _)| path)
    }

    /// [`Self::create_unique_note`] with initial content.
    pub fn create_unique_note_with(
        &self,
        folder: Option<&RelPath>,
        base_title: &str,
        content: &str,
    ) -> VaultResult<(RelPath, WriteOutcome)> {
        if let Some(folder) = folder {
            self.guard(folder)?;
        }
        let base = sanitize_title(base_title);
        let dir = match folder {
            Some(folder) => self.resolve(folder)?,
            None => self.root.to_path_buf(),
        };
        let folder_display = folder.map(RelPath::as_str).unwrap_or("");
        self.record_new_dirs(folder.cloned());
        fs::create_dir_all(&dir)
            .map_err(|e| VaultError::io(folder_display, "creating folder", e))?;
        if !dir.is_dir() {
            return Err(VaultError::invalid_input(format!(
                "{folder_display} is not a folder"
            )));
        }
        let hash = hash_bytes(content.as_bytes());
        for n in 0..10_000u32 {
            let name = if n == 0 {
                format!("{base}.md")
            } else {
                format!("{base} {n}.md")
            };
            let rel = RelPath::in_folder(folder, &name)?;
            let path = dir.join(&name);
            let mut file = match OpenOptions::new().write(true).create_new(true).open(&path) {
                Ok(file) => file,
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(VaultError::io(rel.as_str(), "creating", e)),
            };
            self.recent
                .record(rel.as_str(), Expected::Content(hash.clone()));
            let written = file
                .write_all(content.as_bytes())
                .and_then(|_| file.sync_all());
            if let Err(e) = written {
                drop(file);
                let _ = fs::remove_file(&path);
                return Err(VaultError::io(rel.as_str(), "writing", e));
            }
            drop(file);
            sync_dir(&dir);
            let meta =
                fs::metadata(&path).map_err(|e| VaultError::io(rel.as_str(), "reading", e))?;
            return Ok((
                rel,
                WriteOutcome {
                    hash,
                    mtime_ms: mtime_ms(&meta),
                },
            ));
        }
        Err(VaultError::invalid_input(format!(
            "too many notes named {base}"
        )))
    }

    /// Renames a file or folder. `AlreadyExists` if `to` is taken (a
    /// case-only rename of the same entry is allowed, also on
    /// case-insensitive file systems). Creates missing parents of `to`.
    pub fn rename(&self, from: &RelPath, to: &RelPath) -> VaultResult<()> {
        self.guard(from)?;
        self.guard(to)?;
        if from == to {
            return Ok(());
        }
        let lower_from = from.as_str().to_lowercase();
        let lower_to = to.as_str().to_lowercase();
        if to.starts_with(from)
            || (lower_to.starts_with(&lower_from)
                && lower_to.as_bytes().get(lower_from.len()) == Some(&b'/'))
        {
            return Err(VaultError::invalid_input(format!(
                "cannot move {from} into itself"
            )));
        }
        let from_abs = self.resolve_entry(from)?;
        let from_meta = fs::symlink_metadata(&from_abs)
            .map_err(|e| VaultError::io(from.as_str(), "renaming", e))?;
        let to_parent = match to.parent() {
            Some(parent) => {
                let dir = self.resolve(&parent)?;
                self.record_new_dirs(Some(parent.clone()));
                fs::create_dir_all(&dir)
                    .map_err(|e| VaultError::io(parent.as_str(), "creating folder", e))?;
                // Re-resolve: the folders now exist and are canonicalised.
                self.resolve(&parent)?
            }
            None => self.root.to_path_buf(),
        };
        let to_abs = to_parent.join(to.file_name());
        let case_only = match fs::symlink_metadata(&to_abs) {
            Ok(to_meta) if same_entry(&from_meta, &to_meta, &from_abs, &to_abs) => true,
            Ok(_) => {
                return Err(VaultError::AlreadyExists {
                    path: to.to_string(),
                })
            }
            Err(_) => false,
        };

        self.record_move(from, to, &from_abs, from_meta.is_dir());
        if case_only {
            // Two-step through a temp name so file systems that treat a
            // case-only rename as a no-op still pick up the new case.
            let tmp = to_parent.join(format!("{TMP_PREFIX}{}", uuid::Uuid::new_v4().simple()));
            fs::rename(&from_abs, &tmp)
                .map_err(|e| VaultError::io(from.as_str(), "renaming", e))?;
            if let Err(e) = fs::rename(&tmp, &to_abs) {
                let _ = fs::rename(&tmp, &from_abs);
                return Err(VaultError::io(to.as_str(), "renaming", e));
            }
            if from_meta.is_file() {
                if let Ok(bytes) = fs::read(&to_abs) {
                    self.recent
                        .record(from.as_str(), Expected::Content(hash_bytes(bytes)));
                }
            } else if from_meta.is_dir() {
                self.recent.record(from.as_str(), Expected::Dir);
            }
        } else {
            fs::rename(&from_abs, &to_abs)
                .map_err(|e| VaultError::io(from.as_str(), "renaming", e))?;
        }
        if let Some(parent) = from_abs.parent() {
            sync_dir(parent);
        }
        sync_dir(&to_parent);
        Ok(())
    }

    /// Records what a move from `from` to `to` will look like on disk so the
    /// watcher drops the resulting events.
    fn record_move(&self, from: &RelPath, to: &RelPath, from_abs: &Path, is_dir: bool) {
        self.recent.record(from.as_str(), Expected::Absent);
        if !is_dir {
            if let Ok(bytes) = fs::read(from_abs) {
                self.recent
                    .record(to.as_str(), Expected::Content(hash_bytes(bytes)));
            }
            return;
        }
        self.recent.record(to.as_str(), Expected::Dir);
        for entry in walkdir::WalkDir::new(from_abs)
            .min_depth(1)
            .max_depth(32)
            .into_iter()
            .filter_map(Result::ok)
            .take(20_000)
        {
            let Ok(sub) = entry.path().strip_prefix(from_abs) else {
                continue;
            };
            let Ok(sub) = RelPath::from_os_relative(sub) else {
                continue;
            };
            let old = format!("{from}/{sub}");
            let new = format!("{to}/{sub}");
            self.recent.record(&old, Expected::Absent);
            if entry.file_type().is_dir() {
                self.recent.record(&new, Expected::Dir);
            } else if let Ok(bytes) = fs::read(entry.path()) {
                self.recent
                    .record(&new, Expected::Content(hash_bytes(bytes)));
            }
        }
    }

    /// Moves `rel` into `<root>/.trash/<rel>` (adding ` 1`, ` 2`, … before
    /// the extension if that is taken). Never deletes anything. Returns the
    /// location inside the trash.
    pub fn trash(&self, rel: &RelPath) -> VaultResult<RelPath> {
        self.guard(rel)?;
        let from_abs = self.resolve_entry(rel)?;
        let meta = fs::symlink_metadata(&from_abs)
            .map_err(|e| VaultError::io(rel.as_str(), "trashing", e))?;
        let trash_root = RelPath::new(TRASH_DIR)?;
        let mut dest = None;
        for n in 0..10_000u32 {
            let candidate = if n == 0 {
                trash_root.join(rel.as_str())?
            } else {
                let name = numbered_name(rel.file_name(), n, meta.is_dir());
                match rel.parent() {
                    Some(parent) => trash_root.join(&format!("{parent}/{name}"))?,
                    None => trash_root.join(&name)?,
                }
            };
            let abs = self.resolve(&candidate)?;
            if fs::symlink_metadata(&abs).is_err() {
                dest = Some((candidate, abs));
                break;
            }
        }
        let (dest, dest_abs) =
            dest.ok_or_else(|| VaultError::invalid_input(format!("trash is full for {rel}")))?;
        if let Some(parent) = dest_abs.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| VaultError::io(dest.as_str(), "creating folder", e))?;
        }
        self.record_move(rel, &dest, &from_abs, meta.is_dir());
        fs::rename(&from_abs, &dest_abs)
            .map_err(|e| VaultError::io(rel.as_str(), "trashing", e))?;
        if let Some(parent) = from_abs.parent() {
            sync_dir(parent);
        }
        Ok(dest)
    }

    // ---- listing ---------------------------------------------------------

    /// The visible tree: folders first, then case-insensitive natural order.
    /// Hides dotfiles (`.ostralith`, `.git`, `.trash`, …) and `.icloud`
    /// placeholders. Symlinked files are listed if they point inside the
    /// vault; symlinked folders are skipped (no cycles).
    pub fn list_tree(&self) -> VaultResult<Vec<TreeEntry>> {
        self.list_dir(&self.root, None, 0)
    }

    fn list_dir(
        &self,
        dir: &Path,
        prefix: Option<&RelPath>,
        depth: usize,
    ) -> VaultResult<Vec<TreeEntry>> {
        let display = prefix.map(RelPath::as_str).unwrap_or("");
        let reader = fs::read_dir(dir).map_err(|e| VaultError::io(display, "listing", e))?;
        let mut out = Vec::new();
        for entry in reader.filter_map(Result::ok) {
            let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            if is_hidden_name(&name) {
                continue;
            }
            let Ok(path) = RelPath::in_folder(prefix, &name) else {
                log::debug!("skipping unrepresentable path {name:?} in {display:?}");
                continue;
            };
            let Some(meta) = self.visible_meta(&entry.path()) else {
                continue;
            };
            let mtime = mtime_ms(&meta);
            if meta.is_dir() {
                let children = if depth < 64 {
                    self.list_dir(&entry.path(), Some(&path), depth + 1)
                        .unwrap_or_default()
                } else {
                    Vec::new()
                };
                out.push(TreeEntry {
                    path,
                    name,
                    kind: EntryKind::Folder,
                    mtime,
                    children,
                });
            } else {
                let kind = if path.is_note() {
                    EntryKind::Note
                } else {
                    EntryKind::File
                };
                out.push(TreeEntry {
                    path,
                    name,
                    kind,
                    mtime,
                    children: Vec::new(),
                });
            }
        }
        out.sort_by(tree_order);
        Ok(out)
    }

    /// Metadata to show for `abs`, or `None` to hide it: regular files and
    /// folders as is; symlinks only if they are files inside the vault.
    fn visible_meta(&self, abs: &Path) -> Option<Metadata> {
        let meta = fs::symlink_metadata(abs).ok()?;
        if !meta.file_type().is_symlink() {
            return Some(meta);
        }
        let target = fs::canonicalize(abs).ok()?;
        if !target.starts_with(&*self.root) {
            return None;
        }
        let meta = fs::metadata(&target).ok()?;
        meta.is_file().then_some(meta)
    }

    /// Every visible `*.md` in the vault (same hiding rules as the tree).
    pub fn walk_notes(&self) -> impl Iterator<Item = NoteEntry> {
        let this = self.clone();
        let root = self.root.clone();
        walkdir::WalkDir::new(root.as_path())
            .min_depth(1)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| !e.file_name().to_str().is_some_and(is_hidden_name))
            .filter_map(Result::ok)
            .filter_map(move |entry| {
                let rel = entry.path().strip_prefix(root.as_path()).ok()?;
                let path = RelPath::from_os_relative(rel).ok()?;
                if !path.is_note() {
                    return None;
                }
                let meta = this.visible_meta(entry.path())?;
                if !meta.is_file() {
                    return None;
                }
                Some(NoteEntry {
                    path,
                    mtime_ms: mtime_ms(&meta),
                    size: meta.len() as f64,
                })
            })
    }

    /// Paths of every note, sorted.
    pub fn note_paths(&self) -> Vec<RelPath> {
        let mut paths: Vec<RelPath> = self.walk_notes().map(|n| n.path).collect();
        paths.sort();
        paths
    }
}

fn tree_order(a: &TreeEntry, b: &TreeEntry) -> Ordering {
    let rank = |e: &TreeEntry| u8::from(e.kind != EntryKind::Folder);
    rank(a)
        .cmp(&rank(b))
        .then_with(|| natural_cmp(&a.name, &b.name))
}

/// `Note.md` + 2 → `Note 2.md`; folders get the suffix at the end.
fn numbered_name(name: &str, n: u32, is_dir: bool) -> String {
    match name.rfind('.') {
        Some(i) if i > 0 && !is_dir => format!("{} {n}{}", &name[..i], &name[i..]),
        _ => format!("{name} {n}"),
    }
}

/// Turns a user-supplied title into a safe file stem.
fn sanitize_title(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => ' ',
            c if c.is_control() => ' ',
            c => c,
        })
        .collect();
    let mut stem = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    stem = stem
        .trim_start_matches(|c: char| c == '.' || c.is_whitespace())
        .to_string();
    if stem.len() > 200 {
        let mut cut = 200;
        while !stem.is_char_boundary(cut) {
            cut -= 1;
        }
        stem.truncate(cut);
        stem = stem.trim_end().to_string();
    }
    if stem.is_empty() || RelPath::new(format!("{stem}.md")).is_err() {
        "Untitled".to_string()
    } else {
        stem
    }
}

#[cfg(unix)]
fn same_entry(a: &Metadata, b: &Metadata, _: &Path, _: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    a.dev() == b.dev() && a.ino() == b.ino()
}

#[cfg(not(unix))]
fn same_entry(_: &Metadata, _: &Metadata, a: &Path, b: &Path) -> bool {
    a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
}

/// Best-effort fsync of a directory so a rename survives a crash.
fn sync_dir(dir: &Path) {
    #[cfg(unix)]
    if let Ok(file) = fs::File::open(dir) {
        let _ = file.sync_all();
    }
    #[cfg(not(unix))]
    let _ = dir;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault() -> (tempfile::TempDir, VaultFs) {
        let dir = tempfile::tempdir().unwrap();
        let fs = VaultFs::new(dir.path()).unwrap();
        (dir, fs)
    }

    fn rel(s: &str) -> RelPath {
        RelPath::new(s).unwrap()
    }

    #[test]
    fn write_read_round_trip_and_conflict() {
        let (_d, fs) = vault();
        let p = rel("a/b/Note.md");
        let first = fs.write_atomic(&p, "one", None).unwrap();
        assert_eq!(first.hash, hash_bytes("one"));
        assert!(first.mtime_ms > 0.0);
        assert_eq!(fs.read_to_string(&p).unwrap(), "one");

        let second = fs.write_atomic(&p, "two", Some(&first.hash)).unwrap();
        let stale = fs.write_atomic(&p, "three", Some(&first.hash));
        assert!(matches!(stale, Err(VaultError::Conflict { .. })));
        assert_eq!(fs.read_to_string(&p).unwrap(), "two");
        fs.write_atomic(&p, "three", Some(&second.hash)).unwrap();

        let missing = fs.write_atomic(&rel("gone.md"), "x", Some(&first.hash));
        assert!(matches!(missing, Err(VaultError::Conflict { .. })));

        // No temp files left behind.
        let leftovers: Vec<_> = std::fs::read_dir(fs.root().join("a/b"))
            .unwrap()
            .filter_map(Result::ok)
            .filter(|e| e.file_name().to_string_lossy().starts_with(TMP_PREFIX))
            .collect();
        assert!(leftovers.is_empty());
        assert!(fs.recent_writes().has("a/b/Note.md"));
    }

    #[test]
    fn read_file_reports_hash() {
        let (_d, fs) = vault();
        let p = rel("n.md");
        let out = fs.write_atomic(&p, "hello", None).unwrap();
        let file = fs.read_file(&p).unwrap();
        assert_eq!(file.hash, out.hash);
        assert_eq!(file.content, "hello");
        assert!(matches!(
            fs.read_to_string(&rel("nope.md")),
            Err(VaultError::NotFound { .. })
        ));
    }

    #[test]
    fn reserved_folders_are_refused() {
        let (_d, fs) = vault();
        for p in [
            ".ostralith/vault.json",
            ".git/config",
            ".trash/x.md",
            ".Git/x",
        ] {
            assert!(fs.write_atomic(&rel(p), "x", None).is_err(), "{p}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn symlink_escaping_the_vault_is_rejected() {
        let (_d, fs) = vault();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret.md"), "secret").unwrap();
        std::os::unix::fs::symlink(outside.path(), fs.root().join("link")).unwrap();
        std::os::unix::fs::symlink(outside.path().join("secret.md"), fs.root().join("s.md"))
            .unwrap();

        assert!(matches!(
            fs.read_to_string(&rel("link/secret.md")),
            Err(VaultError::PathOutsideVault { .. })
        ));
        assert!(matches!(
            fs.write_atomic(&rel("link/new.md"), "x", None),
            Err(VaultError::PathOutsideVault { .. })
        ));
        assert!(matches!(
            fs.write_atomic(&rel("link/deeper/new.md"), "x", None),
            Err(VaultError::PathOutsideVault { .. })
        ));
        assert!(matches!(
            fs.read_to_string(&rel("s.md")),
            Err(VaultError::PathOutsideVault { .. })
        ));
        assert!(!outside.path().join("new.md").exists());
        assert!(!outside.path().join("deeper").exists());

        // Hidden from listing and walking.
        let tree = fs.list_tree().unwrap();
        assert!(tree.iter().all(|e| e.name != "link" && e.name != "s.md"));
        assert_eq!(fs.walk_notes().count(), 0);

        // Symlinks that stay inside are fine.
        std::fs::create_dir(fs.root().join("real")).unwrap();
        std::os::unix::fs::symlink(fs.root().join("real"), fs.root().join("inner")).unwrap();
        fs.write_atomic(&rel("inner/ok.md"), "ok", None).unwrap();
        assert_eq!(
            std::fs::read_to_string(fs.root().join("real/ok.md")).unwrap(),
            "ok"
        );
    }

    #[test]
    fn unique_untitled_names() {
        let (_d, fs) = vault();
        let a = fs.create_unique_note(None, "").unwrap();
        let b = fs.create_unique_note(None, "  ").unwrap();
        let c = fs.create_unique_note(None, "Untitled").unwrap();
        assert_eq!(
            [a.as_str(), b.as_str(), c.as_str()],
            ["Untitled.md", "Untitled 1.md", "Untitled 2.md"]
        );
        let folder = rel("Projects");
        let (d, out) = fs
            .create_unique_note_with(Some(&folder), "My: idea?", "# My idea\n")
            .unwrap();
        assert_eq!(d.as_str(), "Projects/My idea.md");
        assert_eq!(out.hash, hash_bytes("# My idea\n"));
        assert_eq!(fs.read_to_string(&d).unwrap(), "# My idea\n");
        assert_eq!(
            fs.create_unique_note(None, "../../etc").unwrap().as_str(),
            "etc.md"
        );
        assert_eq!(
            fs.create_unique_note(None, "con").unwrap().as_str(),
            "Untitled 3.md"
        );
    }

    #[test]
    fn trash_never_deletes_and_handles_clashes() {
        let (_d, fs) = vault();
        let p = rel("dir/Note.md");
        fs.write_atomic(&p, "v1", None).unwrap();
        let t1 = fs.trash(&p).unwrap();
        assert_eq!(t1.as_str(), ".trash/dir/Note.md");
        fs.write_atomic(&p, "v2", None).unwrap();
        let t2 = fs.trash(&p).unwrap();
        assert_eq!(t2.as_str(), ".trash/dir/Note 1.md");
        fs.write_atomic(&p, "v3", None).unwrap();
        let t3 = fs.trash(&p).unwrap();
        assert_eq!(t3.as_str(), ".trash/dir/Note 2.md");
        let root = fs.root();
        assert_eq!(
            std::fs::read_to_string(root.join(".trash/dir/Note.md")).unwrap(),
            "v1"
        );
        assert_eq!(
            std::fs::read_to_string(root.join(".trash/dir/Note 1.md")).unwrap(),
            "v2"
        );
        assert_eq!(
            std::fs::read_to_string(root.join(".trash/dir/Note 2.md")).unwrap(),
            "v3"
        );
        assert!(!fs.exists(&p));

        // Folders too.
        let t4 = fs.trash(&rel("dir")).unwrap();
        assert_eq!(t4.as_str(), ".trash/dir 1");
        assert!(root.join(".trash/dir 1").is_dir());
        assert!(matches!(
            fs.trash(&rel("dir")),
            Err(VaultError::NotFound { .. })
        ));
        // The trash itself is hidden.
        assert!(fs.list_tree().unwrap().is_empty());
    }

    #[test]
    fn rename_rules() {
        let (_d, fs) = vault();
        fs.write_atomic(&rel("a.md"), "a", None).unwrap();
        fs.write_atomic(&rel("b.md"), "b", None).unwrap();
        assert!(matches!(
            fs.rename(&rel("a.md"), &rel("b.md")),
            Err(VaultError::AlreadyExists { .. })
        ));
        fs.rename(&rel("a.md"), &rel("sub/dir/c.md")).unwrap();
        assert_eq!(fs.read_to_string(&rel("sub/dir/c.md")).unwrap(), "a");
        assert!(matches!(
            fs.rename(&rel("missing.md"), &rel("x.md")),
            Err(VaultError::NotFound { .. })
        ));
        assert!(fs.rename(&rel("sub"), &rel("sub/inner")).is_err());

        // Case-only rename.
        fs.rename(&rel("b.md"), &rel("B.md")).unwrap();
        let names: Vec<String> = std::fs::read_dir(fs.root())
            .unwrap()
            .filter_map(Result::ok)
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| !n.starts_with('.'))
            .collect();
        assert!(names.contains(&"B.md".to_string()), "{names:?}");
        assert!(!names.contains(&"b.md".to_string()), "{names:?}");
        fs.rename(&rel("sub"), &rel("Sub")).unwrap();
        assert_eq!(fs.read_to_string(&rel("Sub/dir/c.md")).unwrap(), "a");
    }

    #[test]
    fn create_dir_and_exists() {
        let (_d, fs) = vault();
        fs.create_dir(&rel("x/y")).unwrap();
        assert!(fs.is_dir(&rel("x/y")));
        assert!(matches!(
            fs.create_dir(&rel("x/y")),
            Err(VaultError::AlreadyExists { .. })
        ));
    }

    #[test]
    fn list_tree_orders_and_hides() {
        let (_d, fs) = vault();
        let root = fs.root().to_path_buf();
        for f in [
            "Note 10.md",
            "note 2.md",
            "Note 1.md",
            "image.png",
            ".hidden.md",
            "Doc.pdf.icloud",
            "zeta/inner.md",
            "Alpha/b.md",
            "Alpha/a.md",
            ".git/config",
            ".ostralith/vault.json",
            ".trash/old.md",
            "zeta/.DS_Store",
        ] {
            let path = root.join(f);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, "x").unwrap();
        }
        let tree = fs.list_tree().unwrap();
        let names: Vec<&str> = tree.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(
            names,
            [
                "Alpha",
                "zeta",
                "image.png",
                "Note 1.md",
                "note 2.md",
                "Note 10.md"
            ]
        );
        assert_eq!(tree[0].kind, EntryKind::Folder);
        assert_eq!(tree[2].kind, EntryKind::File);
        assert_eq!(tree[3].kind, EntryKind::Note);
        let alpha: Vec<&str> = tree[0].children.iter().map(|e| e.path.as_str()).collect();
        assert_eq!(alpha, ["Alpha/a.md", "Alpha/b.md"]);
        assert_eq!(tree[1].children.len(), 1);
        assert!(tree[3].mtime > 0.0);

        let notes = fs.note_paths();
        let notes: Vec<&str> = notes.iter().map(RelPath::as_str).collect();
        assert_eq!(
            notes,
            [
                "Alpha/a.md",
                "Alpha/b.md",
                "Note 1.md",
                "Note 10.md",
                "note 2.md",
                "zeta/inner.md"
            ]
        );
    }

    #[test]
    fn helpers() {
        assert_eq!(numbered_name("a.md", 2, false), "a 2.md");
        assert_eq!(numbered_name("dir.v1", 2, true), "dir.v1 2");
        assert_eq!(numbered_name(".x", 1, false), ".x 1");
        assert_eq!(sanitize_title("  a/b  "), "a b");
        assert_eq!(sanitize_title("..."), "Untitled");
    }
}
