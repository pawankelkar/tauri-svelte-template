//! Git backup of a vault folder.
//!
//! The vault root *is* the work tree: snapshots are ordinary commits on
//! `main`, so the user can inspect or restore them with any git tool.
//!
//! # Network rule
//!
//! Only [`GitBackup::push`], [`GitBackup::fetch`] and [`GitBackup::pull`]
//! talk to a remote. This crate does **not** check the network policy: the
//! caller must run `NetClient::authorize_external(..)` on
//! [`authorization_url`]`(remote_url)` first and only call these functions
//! if it succeeded. Everything else here is local file IO.

mod pull;
mod remote;

use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use git2::{
    Commit, Diff, DiffFindOptions, DiffOptions, ErrorCode, IndexAddOption, ObjectType, Oid,
    Repository, RepositoryInitOptions, RepositoryOpenFlags, Signature, StatusOptions, Tree,
};

use crate::error::{Result, SyncError};

pub use pull::PullOutcome;
pub use remote::{authorization_url, Credentials, Divergence};

/// Branch created by [`GitBackup::init`].
pub const DEFAULT_BRANCH: &str = "main";
/// Name of the single remote the backup pushes to.
pub const REMOTE_NAME: &str = "origin";

/// Lines [`GitBackup::init`] makes sure are in the vault's `.gitignore`.
pub const GITIGNORE_ENTRIES: &[&str] = &[
    ".ostralith/cache/",
    ".trash/",
    "Attachments/Audio/",
    ".DS_Store",
];

const FALLBACK_NAME: &str = "Ostralith";
const FALLBACK_EMAIL: &str = "ostralith@localhost";
/// Changed-file lines in a default snapshot message.
const MAX_MESSAGE_FILES: usize = 10;

/// One commit, as the UI shows it.
#[derive(Debug, Clone, PartialEq)]
pub struct Snapshot {
    /// Full commit sha (hex).
    pub id: String,
    /// First line of the commit message.
    pub message: String,
    /// Commit time, ms since the Unix epoch.
    pub time_ms: f64,
    /// Files added, modified, deleted or renamed relative to the first
    /// parent (the whole tree for the first commit).
    pub files_changed: u32,
}

/// Summary for the backup panel.
#[derive(Debug, Clone, PartialEq)]
pub struct Status {
    /// Paths that differ from the last snapshot (untracked files counted
    /// individually, ignored files not at all).
    pub changed_files: u32,
    pub last_snapshot: Option<Snapshot>,
    /// URL of `origin`, if set.
    pub remote: Option<String>,
    /// Snapshots not yet pushed to `origin` (0 without a remote). Based on
    /// the local `refs/remotes/origin/<branch>`; nothing is fetched.
    pub ahead: u32,
}

/// A vault folder under git backup.
pub struct GitBackup {
    repo: Repository,
    root: PathBuf,
    name: String,
    email: String,
}

impl std::fmt::Debug for GitBackup {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("GitBackup")
            .field("root", &self.root)
            .finish_non_exhaustive()
    }
}

impl GitBackup {
    /// Open the repository whose work tree is exactly `vault_root`.
    ///
    /// Returns `None` if `vault_root` is not itself a git repository. Parent
    /// directories are **not** searched: a vault that happens to live inside
    /// some other repo (dotfiles, a project) is not considered backed up.
    pub fn open(vault_root: impl AsRef<Path>) -> Result<Option<Self>> {
        let root = vault_root.as_ref();
        let repo = match Repository::open_ext(
            root,
            RepositoryOpenFlags::NO_SEARCH,
            std::iter::empty::<&OsStr>(),
        ) {
            Ok(repo) => repo,
            Err(e) if e.code() == ErrorCode::NotFound => return Ok(None),
            Err(e) => return Err(e.into()),
        };
        if repo.is_bare() || repo.workdir().is_none() {
            return Ok(None);
        }
        Ok(Some(Self {
            repo,
            root: root.to_path_buf(),
            name: FALLBACK_NAME.to_string(),
            email: FALLBACK_EMAIL.to_string(),
        }))
    }

    /// `git init` the vault (or reuse an existing repo), make sure the
    /// `.gitignore` has [`GITIGNORE_ENTRIES`] and, if the repo has no commits
    /// yet, snapshot everything as the first commit.
    ///
    /// Idempotent. User lines in an existing `.gitignore` are kept; missing
    /// entries are appended. An existing repo's pending changes (including a
    /// `.gitignore` update) are left for the next [`snapshot`](Self::snapshot).
    ///
    /// `author_name`/`author_email` sign commits when the git config has no
    /// `user.name`/`user.email` (see [`with_signature`](Self::with_signature)).
    pub fn init(
        vault_root: impl AsRef<Path>,
        author_name: &str,
        author_email: &str,
    ) -> Result<Self> {
        let root = vault_root.as_ref();
        let backup = match Self::open(root)? {
            Some(backup) => backup,
            None => {
                let mut opts = RepositoryInitOptions::new();
                opts.initial_head(DEFAULT_BRANCH).mkdir(false);
                let repo = Repository::init_opts(root, &opts)?;
                Self {
                    repo,
                    root: root.to_path_buf(),
                    name: FALLBACK_NAME.to_string(),
                    email: FALLBACK_EMAIL.to_string(),
                }
            }
        }
        .with_signature(author_name, author_email);
        ensure_gitignore(root)?;
        if backup.head_commit()?.is_none() {
            backup.snapshot(Some("Start Ostralith backup"))?;
        }
        Ok(backup)
    }

    /// Author/committer used when the git config (repo, then global) has no
    /// `user.name` + `user.email`. Empty values are ignored.
    pub fn with_signature(mut self, name: &str, email: &str) -> Self {
        if !name.trim().is_empty() {
            self.name = name.trim().to_string();
        }
        if !email.trim().is_empty() {
            self.email = email.trim().to_string();
        }
        self
    }

    /// The vault root this backup was opened on.
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Name of the branch HEAD points at (`main` for repos we created).
    pub fn branch(&self) -> Result<String> {
        let head = self.repo.find_reference("HEAD")?;
        head.symbolic_target()
            .ok()
            .flatten()
            .and_then(|t| t.strip_prefix("refs/heads/"))
            .map(str::to_string)
            .ok_or(SyncError::NoBranch)
    }

    pub fn status(&self) -> Result<Status> {
        Ok(Status {
            changed_files: self.changed_files()?,
            last_snapshot: self
                .head_commit()?
                .map(|c| snapshot_of(&self.repo, &c))
                .transpose()?,
            remote: self.remote_url()?,
            ahead: self.ahead()?,
        })
    }

    /// Number of paths that differ from HEAD (staged or not, untracked
    /// included, ignored excluded).
    pub fn changed_files(&self) -> Result<u32> {
        let mut opts = StatusOptions::new();
        opts.include_untracked(true)
            .recurse_untracked_dirs(true)
            .include_ignored(false)
            .exclude_submodules(true);
        let statuses = self.repo.statuses(Some(&mut opts))?;
        Ok(count(statuses.len()))
    }

    /// Stage every change in the vault (adds, modifications, deletions;
    /// `.gitignore` respected) and commit it.
    ///
    /// Returns `None` when nothing changed since the last snapshot. The
    /// default message is `Snapshot <ISO-8601 local time>` followed by up to
    /// ten lines listing the changed files (`A`/`M`/`D`/`R old -> new`).
    pub fn snapshot(&self, message: Option<&str>) -> Result<Option<Snapshot>> {
        let mut index = self.repo.index()?;
        index.add_all(["*"], IndexAddOption::DEFAULT, None)?;
        index.update_all(["*"], None)?;
        index.write()?;
        let tree_id = index.write_tree()?;
        let tree = self.repo.find_tree(tree_id)?;

        let parent = self.head_commit()?;
        let parent_tree = parent.as_ref().map(Commit::tree).transpose()?;
        match &parent_tree {
            Some(pt) if pt.id() == tree_id => return Ok(None),
            None if tree.is_empty() => return Ok(None),
            _ => {}
        }

        let diff = tree_diff(&self.repo, parent_tree.as_ref(), &tree)?;
        let files_changed = count(diff.deltas().len());
        let message = match message.map(str::trim).filter(|m| !m.is_empty()) {
            Some(m) => m.to_string(),
            None => default_message(&diff),
        };

        let sig = self.signature()?;
        let parents: Vec<&Commit> = parent.iter().collect();
        let id = self
            .repo
            .commit(Some("HEAD"), &sig, &sig, &message, &tree, &parents)?;
        let commit = self.repo.find_commit(id)?;
        Ok(Some(Snapshot {
            id: id.to_string(),
            message: summary(&commit),
            time_ms: commit_time_ms(&commit),
            files_changed,
        }))
    }

    /// The last `limit` snapshots on the current branch, newest first
    /// (first-parent history).
    pub fn recent(&self, limit: usize) -> Result<Vec<Snapshot>> {
        let mut out = Vec::new();
        let mut next = self.head_commit()?;
        while let Some(commit) = next {
            if out.len() >= limit {
                break;
            }
            out.push(snapshot_of(&self.repo, &commit)?);
            next = commit.parent(0).ok();
        }
        Ok(out)
    }

    /// Snapshots in which `rel_path`'s content changed, newest first, at
    /// most `limit`.
    ///
    /// Walks first-parent history. Renames are followed: when the file first
    /// appears under its current name and libgit2's similarity detection
    /// pairs it with a deleted file, older commits are searched under the old
    /// name. Commits that delete the file are not listed (there is nothing to
    /// restore from them).
    pub fn history_for(&self, rel_path: &str, limit: usize) -> Result<Vec<Snapshot>> {
        let rel = validate_rel(rel_path)?;
        let mut out = Vec::new();
        if limit == 0 {
            return Ok(out);
        }
        let mut err = None;
        self.walk_path(rel, |commit, _path, changed| {
            if changed {
                match snapshot_of(&self.repo, commit) {
                    Ok(s) => out.push(s),
                    Err(e) => {
                        err = Some(e);
                        return false;
                    }
                }
            }
            out.len() < limit
        })?;
        match err {
            Some(e) => Err(e),
            None => Ok(out),
        }
    }

    /// Content of `rel_path` as of snapshot `commit_id` (full or abbreviated
    /// sha).
    ///
    /// If the note was renamed since, the old name is tried (same rename
    /// following as [`history_for`](Self::history_for), so any id it returned
    /// can be read with the note's current path). `NotFound` if the file did
    /// not exist at that snapshot, `NotText` if it is not UTF-8.
    pub fn read_at(&self, rel_path: &str, commit_id: &str) -> Result<String> {
        let rel = validate_rel(rel_path)?;
        let not_found = || SyncError::NotFound {
            what: format!("{rel} at snapshot {}", short(commit_id)),
        };
        let commit = self
            .repo
            .revparse_single(commit_id.trim())
            .and_then(|o| o.peel_to_commit())
            .map_err(|_| SyncError::NotFound {
                what: format!("snapshot {}", short(commit_id)),
            })?;
        let tree = commit.tree()?;
        let blob_id = match blob_at(&tree, rel) {
            Some(id) => id,
            None => {
                let mut old_path = None;
                self.walk_path(rel, |c, path, _| {
                    if c.id() == commit.id() {
                        old_path = Some(path.to_string());
                        false
                    } else {
                        true
                    }
                })?;
                old_path
                    .filter(|p| p != rel)
                    .and_then(|p| blob_at(&tree, &p))
                    .ok_or_else(not_found)?
            }
        };
        let blob = self.repo.find_blob(blob_id)?;
        String::from_utf8(blob.content().to_vec()).map_err(|_| SyncError::NotText {
            path: rel.to_string(),
        })
    }

    /// Set (`Some`) or remove (`None`) the `origin` remote.
    ///
    /// URLs with an embedded password (`https://user:token@host/…`) are
    /// refused: they would sit in plain text in `.git/config`. Pass tokens
    /// through [`Credentials`] instead.
    pub fn set_remote(&self, url: Option<&str>) -> Result<()> {
        match url.map(str::trim) {
            Some("") => Err(SyncError::InvalidRemote {
                message: "empty URL".into(),
            }),
            Some(url) => {
                remote::validate_remote_url(url)?;
                if self.repo.find_remote(REMOTE_NAME).is_ok() {
                    self.repo.remote_set_url(REMOTE_NAME, url)?;
                } else {
                    self.repo.remote(REMOTE_NAME, url)?;
                }
                Ok(())
            }
            None => match self.repo.remote_delete(REMOTE_NAME) {
                Err(e) if e.code() == ErrorCode::NotFound => Ok(()),
                other => Ok(other?),
            },
        }
    }

    /// URL of `origin`. Pass it through [`authorization_url`] to
    /// `NetClient::authorize_external` before calling `push`/`fetch`/`pull`.
    pub fn remote_url(&self) -> Result<Option<String>> {
        match self.repo.find_remote(REMOTE_NAME) {
            Ok(remote) => Ok(remote.url().ok().map(str::to_string)),
            Err(e) if e.code() == ErrorCode::NotFound => Ok(None),
            Err(e) if e.class() == git2::ErrorClass::Config => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Snapshots on the current branch that `origin` doesn't have, going by
    /// the last push/fetch. Every commit counts if nothing was pushed yet.
    pub fn ahead(&self) -> Result<u32> {
        if self.remote_url()?.is_none() {
            return Ok(0);
        }
        Ok(self.divergence()?.ahead)
    }

    // ---- internals -------------------------------------------------------

    pub(crate) fn repo(&self) -> &Repository {
        &self.repo
    }

    pub(crate) fn head_commit(&self) -> Result<Option<Commit<'_>>> {
        match self.repo.head() {
            Ok(head) => Ok(Some(head.peel_to_commit()?)),
            Err(e) if matches!(e.code(), ErrorCode::UnbornBranch | ErrorCode::NotFound) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub(crate) fn signature(&self) -> Result<Signature<'static>> {
        match self.repo.signature() {
            Ok(sig) => Ok(sig),
            Err(_) => Ok(Signature::now(&self.name, &self.email)?),
        }
    }

    pub(crate) fn tracking_ref(&self, branch: &str) -> String {
        format!("refs/remotes/{REMOTE_NAME}/{branch}")
    }

    /// Ahead/behind of HEAD vs the remote-tracking ref (no network).
    pub(crate) fn divergence(&self) -> Result<Divergence> {
        let Some(head) = self.head_commit()? else {
            return Ok(Divergence::default());
        };
        let branch = self.branch()?;
        match self.repo.refname_to_id(&self.tracking_ref(&branch)) {
            Ok(upstream) => {
                let (ahead, behind) = self.repo.graph_ahead_behind(head.id(), upstream)?;
                Ok(Divergence {
                    ahead: count(ahead),
                    behind: count(behind),
                })
            }
            Err(_) => {
                let mut walk = self.repo.revwalk()?;
                walk.push(head.id())?;
                Ok(Divergence {
                    ahead: count(walk.count()),
                    behind: 0,
                })
            }
        }
    }

    /// Walk first-parent history from HEAD, tracking `rel`'s name across
    /// renames. `f(commit, path_at_commit, content_changed_here)` returns
    /// whether to keep going.
    fn walk_path<F>(&self, rel: &str, mut f: F) -> Result<()>
    where
        F: FnMut(&Commit<'_>, &str, bool) -> bool,
    {
        let mut path = rel.to_string();
        let mut next = self.head_commit()?;
        while let Some(commit) = next {
            let tree = commit.tree()?;
            let parent = commit.parent(0).ok();
            let parent_tree = parent.as_ref().map(Commit::tree).transpose()?;
            let here = blob_at(&tree, &path);
            let before = parent_tree.as_ref().and_then(|t| blob_at(t, &path));
            let changed = here.is_some() && here != before;
            let renamed_from = match (&here, &before, &parent_tree) {
                (Some(_), None, Some(pt)) => rename_source(&self.repo, pt, &tree, &path)?,
                _ => None,
            };
            if !f(&commit, &path, changed) {
                break;
            }
            if let Some(old) = renamed_from {
                path = old;
            }
            next = parent;
        }
        Ok(())
    }
}

/// Append any missing [`GITIGNORE_ENTRIES`] to `<root>/.gitignore`, keeping
/// whatever the user already has. Entries match ignoring a leading `/` and a
/// trailing `/`.
pub fn ensure_gitignore(root: &Path) -> Result<()> {
    let path = root.join(".gitignore");
    let existing = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(e.into()),
    };
    let norm = |l: &str| {
        l.trim()
            .trim_start_matches('/')
            .trim_end_matches('/')
            .to_string()
    };
    let have: Vec<String> = existing.lines().map(norm).collect();
    let missing: Vec<&str> = GITIGNORE_ENTRIES
        .iter()
        .copied()
        .filter(|e| !have.contains(&norm(e)))
        .collect();
    if missing.is_empty() {
        return Ok(());
    }
    let mut out = existing;
    if !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
    if !out.is_empty() {
        out.push('\n');
    }
    out.push_str("# Ostralith backup\n");
    for entry in missing {
        out.push_str(entry);
        out.push('\n');
    }
    std::fs::write(&path, out)?;
    Ok(())
}

/// A vault-relative, `/`-separated path without `.`/`..` components.
fn validate_rel(path: &str) -> Result<&str> {
    let bad = path.is_empty()
        || path.starts_with('/')
        || path.contains('\\')
        || path.contains('\0')
        || path
            .split('/')
            .any(|c| c.is_empty() || c == "." || c == "..");
    if bad {
        Err(SyncError::InvalidPath {
            path: path.to_string(),
        })
    } else {
        Ok(path)
    }
}

fn short(id: &str) -> &str {
    let id = id.trim();
    id.get(..10).unwrap_or(id)
}

pub(crate) fn count(n: usize) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}

/// First line of the commit message (lossy for non-UTF-8 messages).
fn summary(commit: &Commit<'_>) -> String {
    commit
        .summary_bytes()
        .map(|b| String::from_utf8_lossy(b).into_owned())
        .unwrap_or_default()
}

fn commit_time_ms(commit: &Commit<'_>) -> f64 {
    commit.time().seconds() as f64 * 1000.0
}

fn blob_at(tree: &Tree<'_>, path: &str) -> Option<Oid> {
    tree.get_path(Path::new(path))
        .ok()
        .filter(|e| e.kind() == Some(ObjectType::Blob))
        .map(|e| e.id())
}

/// Diff between two trees (`None` = empty tree) with rename detection.
pub(crate) fn tree_diff<'r>(
    repo: &'r Repository,
    old: Option<&Tree<'_>>,
    new: &Tree<'_>,
) -> Result<Diff<'r>> {
    let mut opts = DiffOptions::new();
    opts.ignore_submodules(true);
    let mut diff = repo.diff_tree_to_tree(old, Some(new), Some(&mut opts))?;
    diff.find_similar(Some(DiffFindOptions::new().renames(true)))?;
    Ok(diff)
}

fn rename_source(
    repo: &Repository,
    old: &Tree<'_>,
    new: &Tree<'_>,
    path: &str,
) -> Result<Option<String>> {
    let diff = tree_diff(repo, Some(old), new)?;
    Ok(diff
        .deltas()
        .find(|d| {
            d.status() == git2::Delta::Renamed
                && d.new_file().path().and_then(Path::to_str) == Some(path)
        })
        .and_then(|d| {
            d.old_file()
                .path()
                .and_then(Path::to_str)
                .map(str::to_string)
        }))
}

pub(crate) fn snapshot_of(repo: &Repository, commit: &Commit<'_>) -> Result<Snapshot> {
    let tree = commit.tree()?;
    let parent_tree = commit.parent(0).ok().map(|p| p.tree()).transpose()?;
    let diff = tree_diff(repo, parent_tree.as_ref(), &tree)?;
    Ok(Snapshot {
        id: commit.id().to_string(),
        message: summary(commit),
        time_ms: commit_time_ms(commit),
        files_changed: count(diff.deltas().len()),
    })
}

fn default_message(diff: &Diff<'_>) -> String {
    let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%:z");
    let lines: Vec<String> = diff
        .deltas()
        .map(|d| {
            let new = d
                .new_file()
                .path()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default();
            let old = d
                .old_file()
                .path()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default();
            match d.status() {
                git2::Delta::Added | git2::Delta::Untracked => format!("A {new}"),
                git2::Delta::Deleted => format!("D {old}"),
                git2::Delta::Renamed => format!("R {old} -> {new}"),
                git2::Delta::Copied => format!("C {old} -> {new}"),
                _ => format!("M {new}"),
            }
        })
        .collect();
    let mut msg = format!("Snapshot {now}\n\n");
    if lines.len() <= MAX_MESSAGE_FILES {
        for l in &lines {
            msg.push_str(l);
            msg.push('\n');
        }
    } else {
        for l in &lines[..MAX_MESSAGE_FILES - 1] {
            msg.push_str(l);
            msg.push('\n');
        }
        let rest = lines.len() - (MAX_MESSAGE_FILES - 1);
        msg.push_str(&format!("… and {rest} more files\n"));
    }
    msg
}

#[cfg(test)]
mod tests;
