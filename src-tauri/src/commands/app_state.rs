use tauri::AppHandle;

use crate::commands::json_store::{data_file_path, load_json, save_json};
use crate::types::PersistedAppState;

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
    let path = data_file_path(&app, APP_STATE_FILE)?;
    save_json(&path, &app_state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::json_store::{load_json as load, save_json as save};
    use std::fs;
    use std::path::PathBuf;

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "tauri-app-state-test-{name}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn round_trips_through_json_store() {
        let dir = scratch_dir("roundtrip");
        let path = dir.join("state.json");
        let value = PersistedAppState {
            left_sidebar_visible: false,
            right_sidebar_visible: true,
            square_corners: true,
            last_quick_pane_entry: Some("hello".to_string()),
            recent_items: vec!["a".to_string(), "b".to_string()],
            onboarding_completed: true,
        };

        save(&path, &value).unwrap();
        let loaded: PersistedAppState = load(&path);
        assert_eq!(loaded, value);
    }

    #[test]
    fn missing_field_falls_back_via_serde_default() {
        let dir = scratch_dir("partial");
        let path = dir.join("state.json");
        fs::write(
            &path,
            r#"{"leftSidebarVisible":false,"onboardingCompleted":true}"#,
        )
        .unwrap();

        let loaded: PersistedAppState = load(&path);
        assert!(!loaded.left_sidebar_visible);
        assert!(loaded.right_sidebar_visible);
        assert!(!loaded.square_corners);
        assert_eq!(loaded.last_quick_pane_entry, None);
        assert!(loaded.recent_items.is_empty());
        assert!(loaded.onboarding_completed);
    }
}
