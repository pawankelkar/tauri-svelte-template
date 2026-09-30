use std::fs;
use std::path::PathBuf;

/// VS Code theme files are a few hundred KB at most; anything bigger is not a
/// theme and must not be slurped into memory.
const MAX_THEME_FILE_BYTES: u64 = 2 * 1024 * 1024;

/// Reads a user-picked VS Code theme file for the import flow.
///
/// The frontend does not use `tauri-plugin-fs`, so this one narrow command
/// stands in for it: extension-pinned to theme JSON, size-capped, contents
/// returned as text for the frontend's JSONC parser to make sense of.
#[tauri::command]
#[specta::specta]
pub fn read_theme_file(path: String) -> Result<String, String> {
    let path = PathBuf::from(path);
    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase());
    if !matches!(extension.as_deref(), Some("json") | Some("jsonc")) {
        return Err("Theme files must end in .json or .jsonc".to_string());
    }
    let metadata =
        fs::metadata(&path).map_err(|e| format!("Could not read the theme file: {e}"))?;
    if metadata.len() > MAX_THEME_FILE_BYTES {
        return Err("That file is too large to be a theme (max 2 MB)".to_string());
    }
    fs::read_to_string(&path).map_err(|e| format!("Could not read the theme file: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::test_support::scratch_dir;

    #[test]
    fn reads_a_theme_json_back() {
        let dir = scratch_dir("theme_import", "reads");
        let path = dir.join("my-theme.json");
        fs::write(&path, r##"{"colors":{"editor.background":"#282a36"}}"##).unwrap();
        let text = read_theme_file(path.to_string_lossy().into_owned()).unwrap();
        assert!(text.contains("editor.background"));
    }

    #[test]
    fn rejects_non_theme_extensions() {
        let err = read_theme_file("C:/anything/theme.exe".to_string()).unwrap_err();
        assert!(err.contains(".json"));
    }

    #[test]
    fn rejects_an_oversized_file() {
        let dir = scratch_dir("theme_import", "oversized");
        let path = dir.join("big.json");
        fs::write(&path, vec![b' '; (MAX_THEME_FILE_BYTES + 1) as usize]).unwrap();
        let err = read_theme_file(path.to_string_lossy().into_owned()).unwrap_err();
        assert!(err.contains("too large"));
    }

    #[test]
    fn surfaces_a_missing_file_as_an_error() {
        let err = read_theme_file("C:/does/not/exist.json".to_string()).unwrap_err();
        assert!(err.contains("Could not read"));
    }
}
