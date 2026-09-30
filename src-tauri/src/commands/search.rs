//! Quick open, full-text search and index progress (P1 contract).
//!
//! Thin wrappers over the open vault's search index and note cache; see
//! `crate::vault_runtime`.

use ostralith_core::CoreError;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::State;

use crate::vault_runtime::{blocking, VaultRuntime};

/// Emitted with an [`IndexStatus`] while the index is (re)building.
pub const INDEX_STATUS_EVENT: &str = "index:status";

/// A run of display text, highlighted or not. Pre-split in Rust so the UI
/// never has to map byte or UTF-16 offsets.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TextPart {
    pub text: String,
    pub highlight: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct QuickOpenItem {
    pub path: String,
    pub title: String,
    pub score: f64,
    pub title_parts: Vec<TextPart>,
    pub path_parts: Vec<TextPart>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: String,
    pub title: String,
    pub score: f64,
    pub snippet: Vec<TextPart>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct IndexStatus {
    pub indexing: bool,
    pub done: u32,
    pub total: u32,
    pub note_count: u32,
}

/// Fuzzy match over title and path. An empty query lists the most recently
/// modified notes.
#[tauri::command]
#[specta::specta]
pub async fn quick_open(
    runtime: State<'_, VaultRuntime>,
    query: String,
    limit: u32,
) -> Result<Vec<QuickOpenItem>, CoreError> {
    let vault = runtime.current()?;
    blocking(move || Ok(vault.quick_open(&query, limit))).await
}

/// Full-text search. Supports quoted phrases, `tag:x` and `path:x`.
#[tauri::command]
#[specta::specta]
pub async fn search_fulltext(
    runtime: State<'_, VaultRuntime>,
    query: String,
    limit: u32,
) -> Result<Vec<SearchHit>, CoreError> {
    let vault = runtime.current()?;
    blocking(move || vault.search(&query, limit)).await
}

// Idle and empty when no vault is open.
#[tauri::command]
#[specta::specta]
pub async fn index_status(runtime: State<'_, VaultRuntime>) -> Result<IndexStatus, CoreError> {
    Ok(runtime
        .try_current()
        .map(|vault| vault.index_status())
        .unwrap_or_default())
}

/// Starts a full rebuild in the background; progress arrives as
/// [`INDEX_STATUS_EVENT`].
#[tauri::command]
#[specta::specta]
pub async fn reindex(runtime: State<'_, VaultRuntime>) -> Result<(), CoreError> {
    runtime.current()?.reindex();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn index_status_starts_idle_and_serialises_as_camel_case() {
        let status = IndexStatus::default();
        assert_eq!(
            serde_json::to_value(status).unwrap(),
            serde_json::json!({ "indexing": false, "done": 0, "total": 0, "noteCount": 0 })
        );
    }

    #[test]
    fn quick_open_items_serialise_as_camel_case() {
        let item = QuickOpenItem {
            path: "a.md".into(),
            title: "A".into(),
            score: 1.0,
            title_parts: vec![TextPart {
                text: "A".into(),
                highlight: true,
            }],
            path_parts: vec![],
        };
        let json = serde_json::to_value(&item).unwrap();
        assert_eq!(json["titleParts"][0]["highlight"], true);
        assert!(json["pathParts"].as_array().unwrap().is_empty());
    }
}
