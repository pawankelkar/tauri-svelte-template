//! Health of the open vault's SQLite cache (P1 contract).
//!
//! A thin wrapper over the open vault's `ostralith-store` database; see
//! `crate::vault_runtime`.

use ostralith_core::CoreError;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::State;

use super::vault::DbEncryption;
use crate::vault_runtime::{blocking, VaultRuntime};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DbStatus {
    pub encryption: DbEncryption,
    pub size_bytes: f64,
    pub schema_version: u32,
    pub note_count: u32,
    pub integrity_ok: bool,
}

#[tauri::command]
#[specta::specta]
pub async fn db_status(runtime: State<'_, VaultRuntime>) -> Result<DbStatus, CoreError> {
    let vault = runtime.current()?;
    blocking(move || vault.db_status()).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn db_status_serialises_as_camel_case() {
        let status = DbStatus {
            encryption: DbEncryption::None,
            size_bytes: 4096.0,
            schema_version: 1,
            note_count: 3,
            integrity_ok: true,
        };
        assert_eq!(
            serde_json::to_value(&status).unwrap(),
            serde_json::json!({
                "encryption": "none",
                "sizeBytes": 4096.0,
                "schemaVersion": 1,
                "noteCount": 3,
                "integrityOk": true
            })
        );
    }
}
