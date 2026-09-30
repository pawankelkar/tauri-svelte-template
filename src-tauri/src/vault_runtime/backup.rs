//! Git backup of the open vault.
//!
//! Pushing is the only network access here, and it only happens after the
//! caller's `authorize` (the app passes `NetClient::authorize_external`)
//! allowed the remote's host. Local remotes (`file://`, plain paths) need
//! no network and skip the check.

use ostralith_core::CoreError;
use ostralith_sync::{authorization_url, Credentials, GitBackup};

use super::open_vault::{OpenVault, GIT_AUTHOR_EMAIL, GIT_AUTHOR_NAME};
use super::{convert, lock};
use crate::commands::backup::{BackupStatus, SnapshotInfo};
use crate::commands::vault::WriteResult;

/// Asks the network policy whether `url` may be contacted.
pub type Authorize<'a> = &'a dyn Fn(&str) -> Result<(), CoreError>;

fn not_initialized() -> CoreError {
    CoreError::invalid_input("git backup is not set up for this vault; run backup_init first")
}

impl OpenVault {
    pub fn backup_status(&self) -> Result<BackupStatus, CoreError> {
        match lock(&self.git).as_ref() {
            Some(git) => Ok(convert::backup_status(git.status()?)),
            None => Ok(convert::uninitialized_backup()),
        }
    }

    pub fn backup_init(&self) -> Result<BackupStatus, CoreError> {
        let mut git = lock(&self.git);
        let backup = GitBackup::init(self.vault.root(), GIT_AUTHOR_NAME, GIT_AUTHOR_EMAIL)?;
        let status = backup.status()?;
        *git = Some(backup);
        Ok(convert::backup_status(status))
    }

    /// Commits every change, then pushes if a remote is set and there is
    /// something to push. A refused authorization or a failed push is
    /// returned as the error (the snapshot itself is kept).
    pub fn backup_now(
        &self,
        message: Option<&str>,
        authorize: Authorize<'_>,
    ) -> Result<Option<SnapshotInfo>, CoreError> {
        let git = lock(&self.git);
        let git = git.as_ref().ok_or_else(not_initialized)?;
        let snapshot = git.snapshot(message.map(str::trim).filter(|m| !m.is_empty()))?;
        if let Some(remote) = git.remote_url()? {
            if snapshot.is_some() || git.ahead()? > 0 {
                if let Some(url) = authorization_url(&remote) {
                    authorize(&url)?;
                }
                git.push(&Credentials::ssh_agent())?;
            }
        }
        Ok(snapshot.map(convert::snapshot))
    }

    pub fn backup_set_remote(&self, url: Option<&str>) -> Result<BackupStatus, CoreError> {
        let git = lock(&self.git);
        let git = git.as_ref().ok_or_else(not_initialized)?;
        git.set_remote(url.map(str::trim).filter(|u| !u.is_empty()))?;
        Ok(convert::backup_status(git.status()?))
    }

    /// Snapshots touching `path`, newest first; empty without a backup.
    pub fn note_history(&self, path: &str, limit: u32) -> Result<Vec<SnapshotInfo>, CoreError> {
        let rel = ostralith_vault::RelPath::new(path)?;
        match lock(&self.git).as_ref() {
            Some(git) => Ok(git
                .history_for(rel.as_str(), limit as usize)?
                .into_iter()
                .map(convert::snapshot)
                .collect()),
            None => Ok(Vec::new()),
        }
    }

    /// Snapshots the current state, then writes the note as it was at
    /// `snapshot_id` (a normal, reindexed write without a hash check).
    pub fn note_restore(&self, path: &str, snapshot_id: &str) -> Result<WriteResult, CoreError> {
        let rel = ostralith_vault::RelPath::new(path)?;
        let content = {
            let git = lock(&self.git);
            let git = git.as_ref().ok_or_else(not_initialized)?;
            git.snapshot(Some(&format!("Before restoring {rel}")))?;
            git.read_at(rel.as_str(), snapshot_id)?
        };
        self.write_note(rel.as_str(), &content, None)
    }
}
