use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct AppPreferences {
    pub theme: String,
    pub language: Option<String>,
    pub global_shortcut: Option<String>,
    pub quick_pane_shortcut: Option<String>,
}

impl Default for AppPreferences {
    fn default() -> Self {
        Self {
            theme: "system".to_string(),
            language: None,
            global_shortcut: None,
            quick_pane_shortcut: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct PersistedAppState {
    pub left_sidebar_visible: bool,
    pub right_sidebar_visible: bool,
    pub square_corners: bool,
    pub last_quick_pane_entry: Option<String>,
    pub recent_items: Vec<String>,
    pub onboarding_completed: bool,
}

impl Default for PersistedAppState {
    fn default() -> Self {
        Self {
            left_sidebar_visible: true,
            right_sidebar_visible: true,
            square_corners: false,
            last_quick_pane_entry: None,
            recent_items: Vec::new(),
            onboarding_completed: false,
        }
    }
}

pub fn validate_theme(theme: &str) -> Result<(), String> {
    match theme {
        "light" | "dark" | "system" => Ok(()),
        _ => Err("Invalid theme: must be 'light', 'dark', or 'system'".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_preferences_shape() {
        let prefs = AppPreferences::default();
        assert_eq!(prefs.theme, "system");
        assert_eq!(prefs.language, None);
        assert_eq!(prefs.global_shortcut, None);
        assert_eq!(prefs.quick_pane_shortcut, None);
    }

    #[test]
    fn validate_theme_accepts_known_values() {
        assert!(validate_theme("light").is_ok());
        assert!(validate_theme("dark").is_ok());
        assert!(validate_theme("system").is_ok());
    }

    #[test]
    fn validate_theme_rejects_unknown_values() {
        assert!(validate_theme("blue").is_err());
        assert!(validate_theme("").is_err());
    }

    #[test]
    fn default_persisted_app_state_shape() {
        let state = PersistedAppState::default();
        assert!(state.left_sidebar_visible);
        assert!(state.right_sidebar_visible);
        assert!(!state.square_corners);
        assert_eq!(state.last_quick_pane_entry, None);
        assert!(state.recent_items.is_empty());
        assert!(!state.onboarding_completed);
    }
}
