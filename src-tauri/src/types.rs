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

/// One mode slot's stored theme state. Mirrors `ThemeProfile` in
/// `src/lib/theme/schema.ts`; the default anchors mirror
/// `DEFAULT_LIGHT`/`DEFAULT_DARK` in `src/lib/theme/presets.ts`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ThemeProfile {
    pub preset_id: String,
    pub customized: bool,
    pub accent: String,
    pub background: String,
    pub foreground: String,
    pub contrast: f64,
}

impl ThemeProfile {
    pub fn default_light() -> Self {
        Self {
            preset_id: "default-light".to_string(),
            customized: false,
            accent: "#171717".to_string(),
            background: "#ffffff".to_string(),
            foreground: "#0a0a0a".to_string(),
            contrast: 50.0,
        }
    }

    pub fn default_dark() -> Self {
        Self {
            preset_id: "default-dark".to_string(),
            customized: false,
            accent: "#fafafa".to_string(),
            background: "#0a0a0a".to_string(),
            foreground: "#fafafa".to_string(),
            contrast: 50.0,
        }
    }
}

/// A VS Code theme the user imported, stored as the already-converted anchor
/// profile plus workbench overrides — never the raw VS Code JSON. Mirrors
/// `ThemePreset` in `src/lib/theme/schema.ts`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ImportedTheme {
    pub id: String,
    pub name: String,
    /// `"light"` or `"dark"` — the mode the theme was authored for.
    pub mode: String,
    pub accent: String,
    pub background: String,
    pub foreground: String,
    pub contrast: f64,
    pub overrides: Option<std::collections::HashMap<String, String>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct AppPreferences {
    pub theme: String,
    pub light_profile: ThemeProfile,
    pub dark_profile: ThemeProfile,
    pub imported_themes: Vec<ImportedTheme>,
    /// UI font family; `None` means the platform's system font stack.
    pub font_family: Option<String>,
    /// Root font size in px. Rem-based sizing scales with it, so this acts
    /// as an overall UI scale rather than a text-only size.
    pub font_size: f64,
    /// `"system"`, `"on"`, or `"off"`.
    pub reduced_motion: String,
    /// Web-style hand cursor over interactive elements instead of the
    /// platform-native arrow.
    pub pointer_cursors: bool,
    /// Native window translucency (Mica/Acrylic on Windows, vibrancy on
    /// macOS) behind the app canvas. No effect on Linux.
    pub window_effects: bool,
    pub language: Option<String>,
    pub global_shortcut: Option<String>,
    pub quick_pane_shortcut: Option<String>,
    /// Per-command overrides for in-app shortcuts, keyed by command id.
    /// A missing key means "use the command's built-in default"; an explicit
    /// `None` means the user unbound the shortcut. Values are normalised
    /// frontend combos (e.g. `"mod+shift+k"`), not Tauri accelerators.
    pub command_shortcuts: std::collections::BTreeMap<String, Option<String>>,
}

impl Default for AppPreferences {
    fn default() -> Self {
        Self {
            theme: "system".to_string(),
            light_profile: ThemeProfile::default_light(),
            dark_profile: ThemeProfile::default_dark(),
            imported_themes: Vec::new(),
            font_family: None,
            font_size: 16.0,
            reduced_motion: "system".to_string(),
            pointer_cursors: false,
            window_effects: false,
            language: None,
            global_shortcut: None,
            // The Quick Pane ships bound so the feature is discoverable on a
            // fresh clone. Because `#[serde(default)]` fills *missing* fields
            // from here while an explicit `null` still deserialises to `None`,
            // "never set" and "user cleared it" stay distinguishable.
            quick_pane_shortcut: Some(DEFAULT_QUICK_PANE_SHORTCUT.to_string()),
            command_shortcuts: std::collections::BTreeMap::new(),
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

fn is_hex_color(value: &str) -> bool {
    let Some(hex) = value.strip_prefix('#') else {
        return false;
    };
    (hex.len() == 3 || hex.len() == 6) && hex.chars().all(|c| c.is_ascii_hexdigit())
}

/// Rejects a structurally broken imported theme before it reaches disk.
///
/// The frontend's `validateThemePreset` is the thorough gate (it knows the
/// token vocabulary); this check only guards the invariants a hand-edited
/// `preferences.json` could break badly enough to poison startup.
pub fn validate_imported_theme(theme: &ImportedTheme) -> Result<(), String> {
    if theme.id.is_empty() {
        return Err("Imported theme id must not be empty".to_string());
    }
    if theme.name.is_empty() {
        return Err("Imported theme name must not be empty".to_string());
    }
    if theme.mode != "light" && theme.mode != "dark" {
        return Err(format!(
            "Imported theme '{}' has invalid mode '{}'",
            theme.id, theme.mode
        ));
    }
    for (field, value) in [
        ("accent", &theme.accent),
        ("background", &theme.background),
        ("foreground", &theme.foreground),
    ] {
        if !is_hex_color(value) {
            return Err(format!(
                "Imported theme '{}' has invalid {field} color",
                theme.id
            ));
        }
    }
    if !(0.0..=100.0).contains(&theme.contrast) {
        return Err(format!(
            "Imported theme '{}' has contrast outside 0-100",
            theme.id
        ));
    }
    Ok(())
}

fn validate_profile(profile: &ThemeProfile, label: &str) -> Result<(), String> {
    if profile.preset_id.is_empty() {
        return Err(format!("{label}.presetId must not be empty"));
    }
    for (field, value) in [
        ("accent", &profile.accent),
        ("background", &profile.background),
        ("foreground", &profile.foreground),
    ] {
        if !is_hex_color(value) {
            return Err(format!("{label}.{field} must be a hex color"));
        }
    }
    if !(0.0..=100.0).contains(&profile.contrast) {
        return Err(format!("{label}.contrast must be 0-100"));
    }
    Ok(())
}

pub fn validate_font_size(size: f64) -> Result<(), String> {
    if (12.0..=20.0).contains(&size) {
        Ok(())
    } else {
        Err("fontSize must be between 12 and 20".to_string())
    }
}

pub fn validate_reduced_motion(value: &str) -> Result<(), String> {
    match value {
        "system" | "on" | "off" => Ok(()),
        _ => Err("Invalid reducedMotion: must be 'system', 'on', or 'off'".to_string()),
    }
}

pub fn validate_preferences(preferences: &AppPreferences) -> Result<(), String> {
    validate_theme(&preferences.theme)?;
    validate_profile(&preferences.light_profile, "lightProfile")?;
    validate_profile(&preferences.dark_profile, "darkProfile")?;
    for theme in &preferences.imported_themes {
        validate_imported_theme(theme)?;
    }
    validate_font_size(preferences.font_size)?;
    validate_reduced_motion(&preferences.reduced_motion)?;
    for (id, combo) in &preferences.command_shortcuts {
        if id.is_empty() {
            return Err("commandShortcuts keys must not be empty".to_string());
        }
        if let Some(combo) = combo {
            if combo.is_empty() {
                return Err(format!(
                    "commandShortcuts['{id}'] must be a combo or null, not an empty string"
                ));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_imported_theme() -> ImportedTheme {
        ImportedTheme {
            id: "dracula-theme".to_string(),
            name: "Dracula Theme".to_string(),
            mode: "dark".to_string(),
            accent: "#ff79c6".to_string(),
            background: "#282a36".to_string(),
            foreground: "#f8f8f2".to_string(),
            contrast: 50.0,
            overrides: None,
        }
    }

    #[test]
    fn default_preferences_shape() {
        let prefs = AppPreferences::default();
        assert_eq!(prefs.theme, "system");
        assert_eq!(prefs.light_profile, ThemeProfile::default_light());
        assert_eq!(prefs.dark_profile, ThemeProfile::default_dark());
        assert!(prefs.imported_themes.is_empty());
        assert_eq!(prefs.language, None);
        assert_eq!(prefs.global_shortcut, None);
        assert_eq!(
            prefs.quick_pane_shortcut,
            Some(DEFAULT_QUICK_PANE_SHORTCUT.to_string())
        );
    }

    #[test]
    fn missing_theme_fields_take_defaults() {
        // A pre-theme-system preferences.json must load cleanly.
        let prefs: AppPreferences = serde_json::from_str(r#"{"theme":"dark"}"#).unwrap();
        assert_eq!(prefs.light_profile, ThemeProfile::default_light());
        assert_eq!(prefs.dark_profile, ThemeProfile::default_dark());
        assert!(prefs.imported_themes.is_empty());
    }

    #[test]
    fn validate_imported_theme_accepts_a_converted_preset() {
        assert!(validate_imported_theme(&sample_imported_theme()).is_ok());
    }

    #[test]
    fn validate_imported_theme_rejects_broken_fields() {
        let mut bad = sample_imported_theme();
        bad.id = String::new();
        assert!(validate_imported_theme(&bad).is_err());

        let mut bad = sample_imported_theme();
        bad.mode = "auto".to_string();
        assert!(validate_imported_theme(&bad).is_err());

        let mut bad = sample_imported_theme();
        bad.background = "not-a-color".to_string();
        assert!(validate_imported_theme(&bad).is_err());

        let mut bad = sample_imported_theme();
        bad.contrast = 150.0;
        assert!(validate_imported_theme(&bad).is_err());
    }

    #[test]
    fn validate_preferences_covers_theme_and_imports() {
        let prefs = AppPreferences {
            imported_themes: vec![sample_imported_theme()],
            ..AppPreferences::default()
        };
        assert!(validate_preferences(&prefs).is_ok());

        let prefs = AppPreferences {
            light_profile: ThemeProfile {
                background: "nope".to_string(),
                ..ThemeProfile::default_light()
            },
            ..AppPreferences::default()
        };
        assert!(validate_preferences(&prefs).is_err());

        let prefs = AppPreferences {
            dark_profile: ThemeProfile {
                contrast: 150.0,
                ..ThemeProfile::default_dark()
            },
            ..AppPreferences::default()
        };
        assert!(validate_preferences(&prefs).is_err());

        let prefs = AppPreferences {
            theme: "blue".to_string(),
            ..AppPreferences::default()
        };
        assert!(validate_preferences(&prefs).is_err());
    }

    #[test]
    fn missing_appearance_fields_take_defaults() {
        // A pre-appearance-prefs preferences.json must load cleanly.
        let prefs: AppPreferences = serde_json::from_str(r#"{"theme":"dark"}"#).unwrap();
        assert_eq!(prefs.font_family, None);
        assert_eq!(prefs.font_size, 16.0);
        assert_eq!(prefs.reduced_motion, "system");
        assert!(!prefs.pointer_cursors);
    }

    #[test]
    fn missing_window_effects_defaults_to_off() {
        // A pre-vibrancy preferences.json must load cleanly.
        let prefs: AppPreferences = serde_json::from_str(r#"{"theme":"dark"}"#).unwrap();
        assert!(!prefs.window_effects);
    }

    #[test]
    fn validate_preferences_rejects_bad_appearance_values() {
        let prefs = AppPreferences {
            font_size: 32.0,
            ..AppPreferences::default()
        };
        assert!(validate_preferences(&prefs).is_err());

        let prefs = AppPreferences {
            reduced_motion: "sometimes".to_string(),
            ..AppPreferences::default()
        };
        assert!(validate_preferences(&prefs).is_err());
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
    fn missing_command_shortcuts_take_the_default() {
        // A pre-override preferences.json must load cleanly.
        let prefs: AppPreferences = serde_json::from_str(r#"{"theme":"dark"}"#).unwrap();
        assert!(prefs.command_shortcuts.is_empty());
    }

    #[test]
    fn command_shortcuts_distinguish_unbound_from_custom() {
        let prefs: AppPreferences = serde_json::from_str(
            r#"{"commandShortcuts":{"open-command-palette":"mod+p","toggle-theme":null}}"#,
        )
        .unwrap();
        assert_eq!(
            prefs.command_shortcuts.get("open-command-palette"),
            Some(&Some("mod+p".to_string()))
        );
        assert_eq!(prefs.command_shortcuts.get("toggle-theme"), Some(&None));
    }

    #[test]
    fn validate_preferences_rejects_bad_command_shortcuts() {
        let mut prefs = AppPreferences::default();
        prefs
            .command_shortcuts
            .insert(String::new(), Some("mod+k".to_string()));
        assert!(validate_preferences(&prefs).is_err());

        let mut prefs = AppPreferences::default();
        prefs
            .command_shortcuts
            .insert("toggle-theme".to_string(), Some(String::new()));
        assert!(validate_preferences(&prefs).is_err());

        let mut prefs = AppPreferences::default();
        prefs
            .command_shortcuts
            .insert("toggle-theme".to_string(), None);
        assert!(validate_preferences(&prefs).is_ok());
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
