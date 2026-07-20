use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::de::DeserializeOwned;
use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};

/// Resolves `<app-data-dir>/<file_name>`, creating the directory if needed.
pub fn data_file_path<R: Runtime>(app: &AppHandle<R>, file_name: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Resolving app data dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("Creating app data dir: {e}"))?;
    Ok(dir.join(file_name))
}

/// Loads and parses `path` as JSON into `T`. Returns `T::default()` on missing
/// or corrupt file. Corrupt files are renamed to `<name>.corrupt-<unix_ts>`.
pub fn load_json<T: DeserializeOwned + Default>(path: &Path) -> T {
    let data = match fs::read_to_string(path) {
        Ok(d) => d,
        Err(_) => return T::default(),
    };

    match serde_json::from_str::<T>(&data) {
        Ok(value) => value,
        Err(e) => {
            let ts = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let file_name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown");
            let backup = path.with_file_name(format!("{file_name}.corrupt-{ts}"));
            let _ = fs::rename(path, &backup);
            log::warn!("{file_name} parse error, backed up to {backup:?}: {e}");
            T::default()
        }
    }
}

/// Atomically writes `value` as pretty JSON to `path` (temp file + rename).
pub fn save_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let json = serde_json::to_string_pretty(value)
        .map_err(|e| format!("Serializing JSON: {e}"))?;

    let tmp_path = path.with_extension("json.tmp");
    fs::write(&tmp_path, &json).map_err(|e| format!("Writing temp file: {e}"))?;

    if let Err(e) = fs::rename(&tmp_path, path) {
        let _ = fs::remove_file(&tmp_path);
        return Err(format!("Renaming temp file: {e}"));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "tauri-app-json-store-test-{name}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[derive(Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
    struct TestData {
        version: u32,
        name: String,
    }

    #[test]
    fn missing_file_returns_default() {
        let dir = scratch_dir("missing");
        let result: TestData = load_json(&dir.join("settings.json"));
        assert_eq!(result, TestData::default());
    }

    #[test]
    fn corrupt_file_is_backed_up_and_returns_default() {
        let dir = scratch_dir("corrupt");
        let path = dir.join("settings.json");
        fs::write(&path, "{ not json").unwrap();

        let result: TestData = load_json(&path);
        assert_eq!(result, TestData::default());
        assert!(!path.exists(), "corrupt file should be renamed away");

        let backups: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                let n = e.file_name().to_string_lossy().to_string();
                n.contains(".corrupt-")
            })
            .collect();
        assert_eq!(backups.len(), 1);
    }

    #[test]
    fn round_trip_write_then_load() {
        let dir = scratch_dir("roundtrip");
        let path = dir.join("settings.json");
        let value = TestData { version: 1, name: "test".to_string() };

        save_json(&path, &value).unwrap();
        assert!(
            !path.with_extension("json.tmp").exists(),
            "tmp file should be gone after rename"
        );

        let loaded: TestData = load_json(&path);
        assert_eq!(loaded, value);
    }
}
