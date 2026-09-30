//! Git snapshots of the open vault (P1 contract).
//!
//! Thin wrappers over the open vault's `ostralith-sync` backup; see
//! `crate::vault_runtime`. Pushing is only ever attempted after
//! `NetClient::authorize_external` allows the remote.

use ostralith_core::CoreError;
use ostralith_net::NetClient;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Manager, State};

use super::vault::WriteResult;
use crate::vault_runtime::{blocking, VaultRuntime};

/// The purpose recorded in the network activity log for pushes.
const PUSH_PURPOSE: &str = "git-backup";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotInfo {
    /// The commit sha.
    pub id: String,
    pub message: String,
    /// Milliseconds since the Unix epoch.
    pub time: f64,
    pub files_changed: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BackupStatus {
    /// Whether the vault is a git repository yet.
    pub initialized: bool,
    /// Files with changes since the last snapshot.
    pub changed_files: u32,
    pub last_snapshot: Option<SnapshotInfo>,
    pub remote: Option<String>,
    /// Snapshots not yet pushed to `remote`.
    pub ahead: u32,
}

#[tauri::command]
#[specta::specta]
pub async fn backup_status(runtime: State<'_, VaultRuntime>) -> Result<BackupStatus, CoreError> {
    let vault = runtime.current()?;
    blocking(move || vault.backup_status()).await
}

/// `git init` in the vault plus a `.gitignore` for caches, `.trash` and
/// recorded audio.
#[tauri::command]
#[specta::specta]
pub async fn backup_init(runtime: State<'_, VaultRuntime>) -> Result<BackupStatus, CoreError> {
    let vault = runtime.current()?;
    blocking(move || vault.backup_init()).await
}

/// Commits every change. `None` when there was nothing to commit.
// Then pushes if a remote is set and the network policy allows its host.
#[tauri::command]
#[specta::specta]
pub async fn backup_now(
    app: AppHandle,
    runtime: State<'_, VaultRuntime>,
    message: Option<String>,
) -> Result<Option<SnapshotInfo>, CoreError> {
    let vault = runtime.current()?;
    blocking(move || {
        let authorize = |url: &str| -> Result<(), CoreError> {
            let net = app.state::<NetClient>();
            net.authorize_external("POST", url, PUSH_PURPOSE)
                .map_err(CoreError::from)
        };
        vault.backup_now(message.as_deref(), &authorize)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn backup_set_remote(
    runtime: State<'_, VaultRuntime>,
    url: Option<String>,
) -> Result<BackupStatus, CoreError> {
    let vault = runtime.current()?;
    blocking(move || vault.backup_set_remote(url.as_deref())).await
}

/// Snapshots touching `path`, newest first.
#[tauri::command]
#[specta::specta]
pub async fn note_history(
    runtime: State<'_, VaultRuntime>,
    path: String,
    limit: u32,
) -> Result<Vec<SnapshotInfo>, CoreError> {
    let vault = runtime.current()?;
    blocking(move || vault.note_history(&path, limit)).await
}

/// Writes the note's content at `snapshot_id` as a new change (taking a
/// snapshot of the current state first).
#[tauri::command]
#[specta::specta]
pub async fn note_restore(
    runtime: State<'_, VaultRuntime>,
    path: String,
    snapshot_id: String,
) -> Result<WriteResult, CoreError> {
    let vault = runtime.current()?;
    blocking(move || vault.note_restore(&path, &snapshot_id)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backup_status_serialises_as_camel_case() {
        let status = BackupStatus {
            initialized: true,
            changed_files: 2,
            last_snapshot: Some(SnapshotInfo {
                id: "abc".into(),
                message: "Snapshot".into(),
                time: 1.0,
                files_changed: 2,
            }),
            remote: None,
            ahead: 0,
        };
        let json = serde_json::to_value(&status).unwrap();
        assert_eq!(json["changedFiles"], 2);
        assert_eq!(json["lastSnapshot"]["filesChanged"], 2);
        assert_eq!(json["remote"], serde_json::Value::Null);
    }
}
