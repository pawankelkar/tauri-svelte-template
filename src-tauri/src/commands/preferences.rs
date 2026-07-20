use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use crate::commands::json_store::{data_file_path, load_json, save_json};
use crate::types::{validate_theme, AppPreferences};

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
    validate_theme(&preferences.theme)?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::json_store::{load_json as load, save_json as save};
    use std::fs;
    use std::path::PathBuf;

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "tauri-app-preferences-test-{name}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn round_trips_through_json_store() {
        let dir = scratch_dir("roundtrip");
        let path = dir.join("preferences.json");
        let value = AppPreferences {
            theme: "dark".to_string(),
            language: Some("en".to_string()),
            global_shortcut: None,
            quick_pane_shortcut: Some("CommandOrControl+Shift+.".to_string()),
        };

        save(&path, &value).unwrap();
        let loaded: AppPreferences = load(&path);
        assert_eq!(loaded, value);
    }

    #[test]
    fn missing_field_falls_back_via_serde_default() {
        let dir = scratch_dir("partial");
        let path = dir.join("preferences.json");
        fs::write(
            &path,
            r#"{"theme":"light","language":"fr","globalShortcut":null}"#,
        )
        .unwrap();

        let loaded: AppPreferences = load(&path);
        assert_eq!(loaded.theme, "light");
        assert_eq!(loaded.language, Some("fr".to_string()));
        assert_eq!(loaded.quick_pane_shortcut, None);
    }
}
