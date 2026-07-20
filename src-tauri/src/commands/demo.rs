#[tauri::command]
#[specta::specta]
pub fn greet(name: &str) -> Result<String, String> {
    if name.chars().count() > 100 {
        return Err("Name too long (max 100 characters)".to_string());
    }
    Ok(format!("Hello, {name}! You've been greeted from Rust!"))
}
