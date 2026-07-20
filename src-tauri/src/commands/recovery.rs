use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;
use tauri::AppHandle;

use super::json_store::data_file_path;

const RECOVERY_DIR: &str = "recovery";
const MAX_RECOVERY_BYTES: usize = 10 * 1024 * 1024;
const MAX_AGE_SECS: u64 = 7 * 24 * 60 * 60;
const MAX_FILENAME_LEN: usize = 200;

fn validate_filename(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("Filename must not be empty".to_string());
    }
    if name.len() > MAX_FILENAME_LEN {
        return Err(format!("Filename exceeds {MAX_FILENAME_LEN} characters"));
    }
    if name.starts_with('.') {
        return Err("Filename must not start with '.'".to_string());
    }
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("Filename must not contain path separators or '..'".to_string());
    }
    Ok(())
}

fn recovery_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let base = data_file_path(app, RECOVERY_DIR)?;
    fs::create_dir_all(&base).map_err(|e| format!("Creating recovery dir: {e}"))?;
    Ok(base)
}

#[tauri::command]
#[specta::specta]
pub async fn save_emergency_data(
    app: AppHandle,
    filename: String,
    data: Value,
) -> Result<(), String> {
    validate_filename(&filename)?;

    let json =
        serde_json::to_string_pretty(&data).map_err(|e| format!("Serializing crash data: {e}"))?;

    if json.len() > MAX_RECOVERY_BYTES {
        return Err(format!(
            "Crash data exceeds the {} MB cap",
            MAX_RECOVERY_BYTES / (1024 * 1024)
        ));
    }

    let dir = recovery_dir(&app)?;
    let path = dir.join(format!("{filename}.json"));
    let tmp = path.with_extension("json.tmp");

    fs::write(&tmp, &json).map_err(|e| format!("Writing crash data: {e}"))?;

    if let Err(e) = fs::rename(&tmp, &path) {
        let _ = fs::remove_file(&tmp);
        return Err(format!("Saving crash data: {e}"));
    }

    log::info!("Crash data saved to {}", path.display());
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn cleanup_old_recovery_files(app: AppHandle) -> Result<u32, String> {
    let dir = recovery_dir(&app)?;

    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return Ok(0),
    };

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let mut removed = 0u32;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }

        let age = path
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d: std::time::Duration| now.saturating_sub(d.as_secs()))
            .unwrap_or(0);

        if age > MAX_AGE_SECS {
            if let Err(e) = fs::remove_file(&path) {
                log::warn!("Removing old crash file {:?}: {e}", path.file_name());
            } else {
                removed += 1;
            }
        }
    }

    if removed > 0 {
        log::info!("Purged {removed} old crash recovery file(s)");
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::test_support::scratch_dir;

    #[test]
    fn validate_rejects_empty() {
        assert!(validate_filename("").is_err());
    }

    #[test]
    fn validate_rejects_dot_prefix() {
        assert!(validate_filename(".hidden").is_err());
    }

    #[test]
    fn validate_rejects_path_separators() {
        assert!(validate_filename("../escape").is_err());
        assert!(validate_filename("sub/file").is_err());
        assert!(validate_filename("sub\\file").is_err());
    }

    #[test]
    fn validate_rejects_too_long() {
        let long = "a".repeat(MAX_FILENAME_LEN + 1);
        assert!(validate_filename(&long).is_err());
    }

    #[test]
    fn validate_accepts_normal_names() {
        assert!(validate_filename("crash-1234567890").is_ok());
        assert!(validate_filename("error_report").is_ok());
        assert!(validate_filename("a").is_ok());
    }

    #[test]
    fn recovery_round_trip() {
        let dir = scratch_dir("recovery", "roundtrip");
        let recovery = dir.join(RECOVERY_DIR);
        fs::create_dir_all(&recovery).unwrap();

        let data =
            serde_json::json!({"message": "test crash", "timestamp": "2026-01-01T00:00:00Z"});
        let json = serde_json::to_string_pretty(&data).unwrap();
        let path = recovery.join("crash-test.json");
        fs::write(&path, &json).unwrap();

        let loaded: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(loaded["message"], "test crash");
    }

    #[test]
    fn oversized_data_is_rejected() {
        let huge = "x".repeat(MAX_RECOVERY_BYTES + 1);
        let data = serde_json::json!({"payload": huge});
        let json = serde_json::to_string_pretty(&data).unwrap();
        assert!(json.len() > MAX_RECOVERY_BYTES);
    }
}
