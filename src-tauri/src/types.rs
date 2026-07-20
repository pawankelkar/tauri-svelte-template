use serde::{Deserialize, Serialize};
use specta::Type;

/// The Quick Pane's out-of-the-box toggle accelerator.
///
/// Spelled the way `toTauriAccelerator()` in `src/lib/shortcuts.ts` spells it,
/// so `preferences.json` only ever contains one form of the same combination.
pub const DEFAULT_QUICK_PANE_SHORTCUT: &str = "CmdOrCtrl+Shift+.";

/// What a registered global shortcut is *for*.
///
/// The app registers more than one accelerator with the OS, but the plugin
/// installs a single handler, so the handler needs a way to tell which
/// registration fired. Keying the registry by purpose gives every accelerator
/// a stable identity that survives the user rebinding it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ShortcutPurpose {
    /// Bring the main window forward from anywhere.
    FocusMain,
    /// Show or dismiss the Quick Pane.
    QuickPane,
}

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
            // The Quick Pane ships bound so the feature is discoverable on a
            // fresh clone. Because `#[serde(default)]` fills *missing* fields
            // from here while an explicit `null` still deserialises to `None`,
            // "never set" and "user cleared it" stay distinguishable.
            quick_pane_shortcut: Some(DEFAULT_QUICK_PANE_SHORTCUT.to_string()),
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
        assert_eq!(
            prefs.quick_pane_shortcut,
            Some(DEFAULT_QUICK_PANE_SHORTCUT.to_string())
        );
    }

    #[test]
    fn missing_quick_pane_shortcut_takes_the_default() {
        let prefs: AppPreferences = serde_json::from_str(r#"{"theme":"dark"}"#).unwrap();
        assert_eq!(
            prefs.quick_pane_shortcut,
            Some(DEFAULT_QUICK_PANE_SHORTCUT.to_string())
        );
    }

    #[test]
    fn explicit_null_quick_pane_shortcut_stays_cleared() {
        // The distinction matters: a user who clears the binding must not have
        // the default handed back to them on the next launch.
        let prefs: AppPreferences =
            serde_json::from_str(r#"{"theme":"dark","quickPaneShortcut":null}"#).unwrap();
        assert_eq!(prefs.quick_pane_shortcut, None);
    }

    #[test]
    fn shortcut_purpose_serialises_as_camel_case() {
        assert_eq!(
            serde_json::to_string(&ShortcutPurpose::QuickPane).unwrap(),
            r#""quickPane""#
        );
        assert_eq!(
            serde_json::to_string(&ShortcutPurpose::FocusMain).unwrap(),
            r#""focusMain""#
        );
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
