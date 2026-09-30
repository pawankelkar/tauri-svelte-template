//! `pull`: fetch `origin` and merge it into the vault, never losing either
//! side of a conflict.

use std::collections::HashSet;
use std::path::Path;

use git2::build::CheckoutBuilder;
use git2::{Index, IndexEntry, IndexTime, Oid};

use super::{snapshot_of, Credentials, GitBackup, Snapshot};
use crate::error::{Result, SyncError};

/// What [`GitBackup::pull`] did.
#[derive(Debug, Clone, PartialEq)]
pub enum PullOutcome {
    /// Nothing new on `origin` (or `origin` has no such branch yet).
    UpToDate,
    /// We had nothing `origin` lacked; moved to its tip.
    FastForward { snapshot: Snapshot },
    /// Both sides changed; a merge snapshot was created. `conflict_copies`
    /// lists the files written for conflicting edits (vault-relative).
    Merged {
        snapshot: Snapshot,
        conflict_copies: Vec<String>,
    },
}

impl GitBackup {
    /// Fetch `origin` and merge its branch into the vault.
    ///
    /// Requires a clean work tree ([`SyncError::Dirty`] otherwise): take a
    /// [`snapshot`](Self::snapshot) first. When both sides edited the same
    /// file, this device's version stays at the original path and the
    /// remote's is saved next to it as
    /// `<name> (conflict <device> <YYYY-MM-DD>).<ext>`; if one side deleted
    /// a file the other edited, the edit wins. The merge is committed, so
    /// the conflict copies are part of the snapshot.
    ///
    /// **Network.** Same contract as [`push`](Self::push): the caller must
    /// authorize the remote URL with `NetClient::authorize_external` first.
    pub fn pull(&self, credentials: &Credentials, device: &str) -> Result<PullOutcome> {
        if self.changed_files()? > 0 {
            return Err(SyncError::Dirty);
        }
        self.fetch(credentials)?;
        self.integrate(device)
    }

    /// The merge half of `pull`, from the already fetched tracking ref.
    pub(crate) fn integrate(&self, device: &str) -> Result<PullOutcome> {
        let repo = self.repo();
        let branch = self.branch()?;
        let Ok(theirs_id) = repo.refname_to_id(&self.tracking_ref(&branch)) else {
            return Ok(PullOutcome::UpToDate);
        };
        let theirs = repo.find_commit(theirs_id)?;
        let local_ref = format!("refs/heads/{branch}");

        let Some(ours) = self.head_commit()? else {
            // Unborn branch: adopt the remote history wholesale.
            repo.checkout_tree(theirs.as_object(), Some(CheckoutBuilder::new().safe()))?;
            repo.reference(&local_ref, theirs_id, true, "ostralith: pull (initial)")?;
            return Ok(PullOutcome::FastForward {
                snapshot: snapshot_of(repo, &theirs)?,
            });
        };

        let (ahead, behind) = repo.graph_ahead_behind(ours.id(), theirs_id)?;
        if behind == 0 {
            return Ok(PullOutcome::UpToDate);
        }
        if ahead == 0 {
            repo.checkout_tree(theirs.as_object(), Some(CheckoutBuilder::new().safe()))?;
            repo.reference(
                &local_ref,
                theirs_id,
                true,
                "ostralith: pull (fast-forward)",
            )?;
            return Ok(PullOutcome::FastForward {
                snapshot: snapshot_of(repo, &theirs)?,
            });
        }

        let mut index = repo.merge_commits(&ours, &theirs, None)?;
        let conflict_copies = if index.has_conflicts() {
            resolve_conflicts(&mut index, device)?
        } else {
            Vec::new()
        };
        let tree = repo.find_tree(index.write_tree_to(repo)?)?;
        let message = if conflict_copies.is_empty() {
            format!("Sync with {}", super::REMOTE_NAME)
        } else {
            let mut m = format!(
                "Sync with {} ({} conflict{})\n\n",
                super::REMOTE_NAME,
                conflict_copies.len(),
                if conflict_copies.len() == 1 { "" } else { "s" }
            );
            for c in &conflict_copies {
                m.push_str(&format!("A {c}\n"));
            }
            m
        };
        let sig = self.signature()?;
        let merge_id = repo.commit(None, &sig, &sig, &message, &tree, &[&ours, &theirs])?;
        let merge = repo.find_commit(merge_id)?;
        repo.checkout_tree(merge.as_object(), Some(CheckoutBuilder::new().safe()))?;
        repo.reference(&local_ref, merge_id, true, "ostralith: pull (merge)")?;
        repo.cleanup_state()?;
        Ok(PullOutcome::Merged {
            snapshot: snapshot_of(repo, &merge)?,
            conflict_copies,
        })
    }
}

/// Resolve every conflict in a merge index: ours at the path, theirs as a
/// conflict copy. Returns the copies' paths.
fn resolve_conflicts(index: &mut Index, device: &str) -> Result<Vec<String>> {
    let conflicts = index
        .conflicts()?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let date = chrono::Local::now().format("%Y-%m-%d").to_string();
    let device = sanitize_device(device);
    let mut taken: HashSet<String> = index
        .iter()
        .map(|e| String::from_utf8_lossy(&e.path).into_owned())
        .collect();
    let mut copies = Vec::new();

    for conflict in conflicts {
        let Some(path) = conflict
            .our
            .as_ref()
            .or(conflict.their.as_ref())
            .or(conflict.ancestor.as_ref())
            .map(|e| String::from_utf8_lossy(&e.path).into_owned())
        else {
            continue;
        };
        index.conflict_remove(Path::new(&path))?;
        match (&conflict.our, &conflict.their) {
            (Some(our), Some(their)) => {
                index.add(&stage0(&path, our.id, our.mode))?;
                let copy = conflict_name(&path, &device, &date, &taken);
                index.add(&stage0(&copy, their.id, their.mode))?;
                taken.insert(copy.clone());
                copies.push(copy);
            }
            // One side deleted, the other edited: keep the edit.
            (Some(kept), None) | (None, Some(kept)) => {
                index.add(&stage0(&path, kept.id, kept.mode))?;
            }
            (None, None) => {}
        }
    }
    Ok(copies)
}

fn stage0(path: &str, id: Oid, mode: u32) -> IndexEntry {
    IndexEntry {
        ctime: IndexTime::new(0, 0),
        mtime: IndexTime::new(0, 0),
        dev: 0,
        ino: 0,
        mode,
        uid: 0,
        gid: 0,
        file_size: 0,
        id,
        // Low 12 bits: path length (capped); stage bits 0.
        flags: path.len().min(0xfff) as u16,
        flags_extended: 0,
        path: path.as_bytes().to_vec(),
    }
}

fn sanitize_device(device: &str) -> String {
    let cleaned: String = device
        .chars()
        .map(|c| {
            if c.is_control() || "/\\:*?\"<>|".contains(c) {
                '-'
            } else {
                c
            }
        })
        .collect();
    let cleaned = cleaned.trim().to_string();
    if cleaned.is_empty() {
        "other device".to_string()
    } else {
        cleaned
    }
}

/// `Folder/note.md` -> `Folder/note (conflict <device> <date>).md`, with a
/// counter appended if that name is taken.
pub(crate) fn conflict_name(
    path: &str,
    device: &str,
    date: &str,
    taken: &HashSet<String>,
) -> String {
    let (dir, file) = match path.rsplit_once('/') {
        Some((d, f)) => (format!("{d}/"), f),
        None => (String::new(), path),
    };
    let (stem, ext) = match file.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s, format!(".{e}")),
        _ => (file, String::new()),
    };
    let base = format!("{dir}{stem} (conflict {device} {date}");
    let mut candidate = format!("{base}){ext}");
    let mut n = 2;
    while taken.contains(&candidate) {
        candidate = format!("{base} {n}){ext}");
        n += 1;
    }
    candidate
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conflict_names() {
        let mut taken = HashSet::new();
        assert_eq!(
            conflict_name("Projects/note.md", "MacBook", "2026-09-30", &taken),
            "Projects/note (conflict MacBook 2026-09-30).md"
        );
        assert_eq!(
            conflict_name("README", "pc", "2026-09-30", &taken),
            "README (conflict pc 2026-09-30)"
        );
        assert_eq!(
            conflict_name(".hidden", "pc", "2026-09-30", &taken),
            ".hidden (conflict pc 2026-09-30)"
        );
        taken.insert("a (conflict pc 2026-09-30).md".to_string());
        assert_eq!(
            conflict_name("a.md", "pc", "2026-09-30", &taken),
            "a (conflict pc 2026-09-30 2).md"
        );
        assert_eq!(sanitize_device(" my/pc: "), "my-pc-");
        assert_eq!(sanitize_device("  "), "other device");
    }
}
