use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use crate::commands::json_store::{data_file_path, load_json, save_json};
use crate::types::{validate_preferences, AppPreferences};

const PREFERENCES_FILE: &str = "preferences.json";

#[tauri::command]
#[specta::specta]
pub async fn load_preferences(app: AppHandle) -> Result<AppPreferences, String> {
    let path = data_file_path(&app, PREFERENCES_FILE)?;
    Ok(load_json(&path))
}

#[tauri::command]
#[specta::specta]
pub async fn save_preferences(app: AppHandle, preferences: AppPreferences) -> Result<(), String> {
    validate_preferences(&preferences)?;
    let path = data_file_path(&app, PREFERENCES_FILE)?;
    save_json(&path, &preferences)
}

#[tauri::command]
#[specta::specta]
pub fn open_preferences_file(app: AppHandle) -> Result<(), String> {
    let path = data_file_path(&app, PREFERENCES_FILE)?;
    if !path.exists() {
        return Err(
            "preferences.json does not exist yet — change a preference to create it".to_string(),
        );
    }
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|e| format!("Failed to open preferences.json: {e}"))
}

/// Reads just the saved global shortcut, synchronously.
///
/// `setup()` runs before the async command path is usable, so startup
/// registration reads the preferences file directly rather than going through
/// `load_preferences`.
pub fn load_global_shortcut(app: &AppHandle) -> Option<String> {
    let path = data_file_path(app, PREFERENCES_FILE).ok()?;
    let preferences: AppPreferences = load_json(&path);
    preferences.global_shortcut
}

/// Reads just the saved Quick Pane shortcut, synchronously. See
/// [`load_global_shortcut`] for why this bypasses the command path.
///
/// Returns `None` only when the user explicitly cleared the binding — a
/// preferences file that has never seen the key falls back to
/// `DEFAULT_QUICK_PANE_SHORTCUT` via `AppPreferences::default()`.
pub fn load_quick_pane_shortcut(app: &AppHandle) -> Option<String> {
    let path = data_file_path(app, PREFERENCES_FILE).ok()?;
    let preferences: AppPreferences = load_json(&path);
    preferences.quick_pane_shortcut
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::test_support::{json_round_trip, scratch_dir};
    use std::fs;

    #[test]
    fn preferences_round_trip() {
        let value = AppPreferences {
            theme: "dark".to_string(),
            language: Some("en".to_string()),
            global_shortcut: None,
            quick_pane_shortcut: Some("CommandOrControl+Shift+.".to_string()),
            ..AppPreferences::default()
        };

        let loaded = json_round_trip("preferences", "roundtrip", PREFERENCES_FILE, &value);
        assert_eq!(loaded, value);
    }

    #[test]
    fn round_trips_a_populated_global_shortcut() {
        let value = AppPreferences {
            theme: "system".to_string(),
            language: None,
            global_shortcut: Some("CmdOrCtrl+K".to_string()),
            quick_pane_shortcut: None,
            ..AppPreferences::default()
        };

        let loaded = json_round_trip("preferences", "global-shortcut", PREFERENCES_FILE, &value);
        assert_eq!(loaded.global_shortcut, Some("CmdOrCtrl+K".to_string()));
    }

    #[test]
    fn missing_field_falls_back_via_serde_default() {
        let dir = scratch_dir("preferences", "partial");
        let path = dir.join("preferences.json");
        fs::write(
            &path,
            r#"{"theme":"light","language":"fr","globalShortcut":null}"#,
        )
        .unwrap();

        let loaded: AppPreferences = load_json(&path);
        assert_eq!(loaded.theme, "light");
        assert_eq!(loaded.language, Some("fr".to_string()));
        assert_eq!(
            loaded.quick_pane_shortcut,
            Some(crate::types::DEFAULT_QUICK_PANE_SHORTCUT.to_string())
        );
    }

    #[test]
    fn a_cleared_quick_pane_shortcut_survives_a_round_trip() {
        let value = AppPreferences {
            quick_pane_shortcut: None,
            ..AppPreferences::default()
        };

        let loaded = json_round_trip(
            "preferences",
            "cleared-quick-pane",
            PREFERENCES_FILE,
            &value,
        );
        assert_eq!(loaded.quick_pane_shortcut, None);
    }
}
