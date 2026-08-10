use std::sync::OnceLock;

/// Family names of every font installed on the OS, enumerated once per
/// process. The webview cannot list fonts itself, so the frontend's font
/// picker asks here.
static FONTS: OnceLock<Vec<String>> = OnceLock::new();

fn enumerate() -> Vec<String> {
    let mut db = fontdb::Database::new();
    db.load_system_fonts();
    let mut names: Vec<String> = db
        .faces()
        .flat_map(|face| face.families.iter().map(|(name, _)| name.clone()))
        .collect();
    names.sort();
    names.dedup();
    names
}

/// Async so the first enumeration (~100ms of directory walking) never blocks
/// the main thread; later calls return the cached list.
#[tauri::command]
#[specta::specta]
pub async fn list_system_fonts() -> Result<Vec<String>, String> {
    Ok(FONTS.get_or_init(enumerate).clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enumerate_returns_sorted_deduped_families() {
        let fonts = enumerate();
        assert!(!fonts.is_empty(), "expected at least one system font");
        let mut sorted = fonts.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(fonts, sorted);
    }
}
