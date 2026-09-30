use std::sync::atomic::Ordering;

use tauri::{AppHandle, State};

use crate::commands::json_store::{data_file_path, load_json, save_json};
use crate::state::AppState;
use crate::types::{validate_app_state, PersistedAppState};

const APP_STATE_FILE: &str = "state.json";

#[tauri::command]
#[specta::specta]
pub async fn load_app_state(app: AppHandle) -> Result<PersistedAppState, String> {
    let path = data_file_path(&app, APP_STATE_FILE)?;
    Ok(load_json(&path))
}

#[tauri::command]
#[specta::specta]
pub async fn save_app_state(app: AppHandle, app_state: PersistedAppState) -> Result<(), String> {
    validate_app_state(&app_state)?;
    let path = data_file_path(&app, APP_STATE_FILE)?;
    save_json(&path, &app_state)
}

#[tauri::command]
#[specta::specta]
pub fn set_has_unsaved_changes(state: State<AppState>, dirty: bool) {
    state.has_unsaved_changes.store(dirty, Ordering::SeqCst);
}

#[tauri::command]
#[specta::specta]
pub fn has_unsaved_changes(state: State<AppState>) -> bool {
    state.has_unsaved_changes.load(Ordering::SeqCst)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::test_support::{json_round_trip, scratch_dir};
    use std::fs;

    #[test]
    fn app_state_round_trips() {
        let value = PersistedAppState {
            left_sidebar_visible: false,
            right_sidebar_visible: true,
            square_corners: true,
            last_quick_pane_entry: Some("hello".to_string()),
            recent_items: vec!["a".to_string(), "b".to_string()],
            onboarding_completed: true,
            open_tabs: vec![crate::types::PersistedTab {
                id: "t1".to_string(),
                kind: "note".to_string(),
                uri: "vault://notes/a.md".to_string(),
                title: "A".to_string(),
                pinned: true,
            }],
            active_tab_id: Some("t1".to_string()),
        };

        let loaded = json_round_trip("app-state", "roundtrip", APP_STATE_FILE, &value);
        assert_eq!(loaded, value);
    }

    #[test]
    fn dirty_flag_defaults_to_false() {
        let state = AppState::default();
        assert!(!state.has_unsaved_changes.load(Ordering::SeqCst));
    }

    #[test]
    fn dirty_flag_round_trips() {
        let state = AppState::default();
        state.has_unsaved_changes.store(true, Ordering::SeqCst);
        assert!(state.has_unsaved_changes.load(Ordering::SeqCst));
        state.has_unsaved_changes.store(false, Ordering::SeqCst);
        assert!(!state.has_unsaved_changes.load(Ordering::SeqCst));
    }

    #[test]
    fn missing_field_falls_back_via_serde_default() {
        let dir = scratch_dir("app-state", "partial");
        let path = dir.join("state.json");
        fs::write(
            &path,
            r#"{"leftSidebarVisible":false,"onboardingCompleted":true}"#,
        )
        .unwrap();

        let loaded: PersistedAppState = load_json(&path);
        assert!(!loaded.left_sidebar_visible);
        assert!(loaded.right_sidebar_visible);
        assert!(!loaded.square_corners);
        assert_eq!(loaded.last_quick_pane_entry, None);
        assert!(loaded.recent_items.is_empty());
        assert!(loaded.onboarding_completed);
        assert!(loaded.open_tabs.is_empty());
        assert_eq!(loaded.active_tab_id, None);
    }
}
