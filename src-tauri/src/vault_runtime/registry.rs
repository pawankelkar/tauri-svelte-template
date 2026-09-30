//! `$APPDATA/vaults.json`: every vault the user has opened.

use std::fs;
use std::io::Read;
use std::path::Path;

use ostralith_core::CoreError;
use serde::{Deserialize, Serialize};

use crate::commands::json_store::{load_json, save_json};
use crate::commands::vault::{DbEncryption, VaultInfo};

const VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Registry {
    pub version: u32,
    pub vaults: Vec<VaultInfo>,
}

impl Default for Registry {
    fn default() -> Self {
        Self {
            version: VERSION,
            vaults: Vec::new(),
        }
    }
}

impl Registry {
    /// Missing or unreadable files load as empty (a corrupt file is moved
    /// aside by `load_json`).
    pub fn load(path: &Path) -> Self {
        load_json(path)
    }

    pub fn save(&self, data_dir: &Path, path: &Path) -> Result<(), CoreError> {
        fs::create_dir_all(data_dir)
            .map_err(|e| CoreError::from(format!("Creating {}: {e}", data_dir.display())))?;
        save_json(path, self).map_err(CoreError::from)
    }

    /// Most recently opened first.
    pub fn sorted(mut self) -> Vec<VaultInfo> {
        self.vaults
            .sort_by(|a, b| b.last_opened_at.total_cmp(&a.last_opened_at));
        self.vaults
    }

    pub fn find(&self, id: &str) -> Option<&VaultInfo> {
        self.vaults.iter().find(|v| v.id == id)
    }

    /// Adds or replaces the entry for `info.id`. An older entry for the same
    /// folder under another id (the marker was recreated) is replaced too.
    pub fn upsert(&mut self, info: VaultInfo) {
        self.vaults
            .retain(|v| v.id != info.id && v.path != info.path);
        self.vaults.push(info);
    }

    pub fn remove(&mut self, id: &str) -> bool {
        let before = self.vaults.len();
        self.vaults.retain(|v| v.id != id);
        self.vaults.len() != before
    }
}

/// For a folder that isn't registered (yet): an existing cache that isn't
/// plain SQLite must be SQLCipher, so keep it encrypted.
pub(super) fn detect_encryption(db_path: &Path) -> DbEncryption {
    let mut header = [0u8; 16];
    let read = fs::File::open(db_path).and_then(|mut f| f.read(&mut header));
    match read {
        Ok(16) if &header == b"SQLite format 3\0" => DbEncryption::None,
        Ok(16) => DbEncryption::Keychain,
        _ => DbEncryption::None,
    }
}
