use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

use tauri::AppHandle;

use crate::commands::preferences::{load_global_shortcut, load_quick_pane_shortcut};
use crate::types::ShortcutPurpose;

/// The accelerators currently registered with the OS, keyed by what they do.
///
/// Tracked here so `unregister_global_shortcut` knows what to release without
/// the frontend having to tell it, and so the single plugin-level handler can
/// work out which registration fired.
static SHORTCUTS: LazyLock<Mutex<HashMap<ShortcutPurpose, String>>> =
    LazyLock::new(Default::default);

fn validate_accelerator(accelerator: &str) -> Result<(), String> {
    if accelerator.trim().is_empty() {
        return Err("Accelerator must not be empty".to_string());
    }
    Ok(())
}

/// Registers `accelerator` for `purpose`, replacing whatever that purpose had
/// registered before. No-ops when the accelerator is already the current one.
#[tauri::command]
#[specta::specta]
pub fn register_global_shortcut(
    app: AppHandle,
    purpose: ShortcutPurpose,
    accelerator: String,
) -> Result<(), String> {
    validate_accelerator(&accelerator)?;
    register_impl(&app, purpose, accelerator)
}

/// Releases the accelerator held for `purpose`, if any.
#[tauri::command]
#[specta::specta]
pub fn unregister_global_shortcut(app: AppHandle, purpose: ShortcutPurpose) -> Result<(), String> {
    unregister_impl(&app, purpose)
}

#[tauri::command]
#[specta::specta]
pub fn is_global_shortcut_registered(app: AppHandle, accelerator: String) -> Result<bool, String> {
    is_registered_impl(&app, &accelerator)
}

/// Registers the user's saved shortcuts during `setup()`.
///
/// Deliberately non-fatal: a stale accelerator, or one another application has
/// already claimed, must never prevent the app from starting.
pub fn register_saved_shortcuts_on_startup(app: &AppHandle) {
    let saved = [
        (ShortcutPurpose::FocusMain, load_global_shortcut(app)),
        (ShortcutPurpose::QuickPane, load_quick_pane_shortcut(app)),
    ];

    for (purpose, accelerator) in saved {
        let Some(accelerator) = accelerator else {
            continue;
        };
        if let Err(e) = register_impl(app, purpose, accelerator.clone()) {
            log::warn!("Could not register saved shortcut '{accelerator}': {e}");
        }
    }
}

/// Releases every accelerator this module holds. Called during `RunEvent::Exit`
/// so nothing is left registered with the OS after teardown.
pub fn unregister_all(app: &AppHandle) {
    for purpose in [ShortcutPurpose::FocusMain, ShortcutPurpose::QuickPane] {
        if let Err(e) = unregister_impl(app, purpose) {
            log::warn!("Could not unregister shortcut on exit: {e}");
        }
    }
}

#[cfg(desktop)]
mod imp {
    use std::str::FromStr;

    use super::{ShortcutPurpose, SHORTCUTS};
    use crate::commands::quick_pane;
    use tauri::{AppHandle, Manager};
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutEvent, ShortcutState};

    /// The action bound to the user's "focus main window" shortcut.
    ///
    /// This is the template's demo behaviour — bring the app forward from
    /// anywhere. Replace the body with whatever your app should do.
    fn focus_main_window(app: &AppHandle) {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }

    /// Works out which purpose owns the accelerator that just fired.
    ///
    /// Compares parsed `Shortcut`s rather than strings: the stored spelling
    /// ("CmdOrCtrl+Shift+.") and the fired one need not match textually, but
    /// both parse to the same modifiers-plus-key value.
    fn purpose_for(fired: &Shortcut) -> Option<ShortcutPurpose> {
        let registered = SHORTCUTS.lock().ok()?;
        registered.iter().find_map(
            |(purpose, accelerator)| match Shortcut::from_str(accelerator) {
                Ok(parsed) if parsed == *fired => Some(*purpose),
                _ => None,
            },
        )
    }

    /// Installed once via `Builder::with_handler` in `lib.rs`; fires for every
    /// accelerator registered through this module.
    pub fn handle_shortcut_event(app: &AppHandle, shortcut: &Shortcut, event: ShortcutEvent) {
        if !matches!(event.state, ShortcutState::Pressed) {
            return;
        }
        match purpose_for(shortcut) {
            Some(ShortcutPurpose::FocusMain) => focus_main_window(app),
            Some(ShortcutPurpose::QuickPane) => quick_pane::toggle(app),
            None => log::debug!("Ignoring an unrecognised global shortcut"),
        }
    }

    pub fn register(
        app: &AppHandle,
        purpose: ShortcutPurpose,
        accelerator: String,
    ) -> Result<(), String> {
        let mut registered = SHORTCUTS
            .lock()
            .map_err(|e| format!("Shortcut state poisoned: {e}"))?;

        if registered.get(&purpose).map(String::as_str) == Some(accelerator.as_str()) {
            return Ok(());
        }
        if let Some(previous) = registered.get(&purpose) {
            let _ = app.global_shortcut().unregister(previous.as_str());
        }
        app.global_shortcut()
            .register(accelerator.as_str())
            .map_err(|e| format!("Failed to register shortcut '{accelerator}': {e}"))?;

        registered.insert(purpose, accelerator);
        Ok(())
    }

    pub fn unregister(app: &AppHandle, purpose: ShortcutPurpose) -> Result<(), String> {
        let mut registered = SHORTCUTS
            .lock()
            .map_err(|e| format!("Shortcut state poisoned: {e}"))?;

        if let Some(accelerator) = registered.remove(&purpose) {
            app.global_shortcut()
                .unregister(accelerator.as_str())
                .map_err(|e| format!("Failed to unregister shortcut '{accelerator}': {e}"))?;
        }
        Ok(())
    }

    pub fn is_registered(app: &AppHandle, accelerator: &str) -> Result<bool, String> {
        Ok(app.global_shortcut().is_registered(accelerator))
    }
}

#[cfg(desktop)]
pub use imp::handle_shortcut_event;

#[cfg(desktop)]
fn register_impl(
    app: &AppHandle,
    purpose: ShortcutPurpose,
    accelerator: String,
) -> Result<(), String> {
    imp::register(app, purpose, accelerator)
}

#[cfg(desktop)]
fn unregister_impl(app: &AppHandle, purpose: ShortcutPurpose) -> Result<(), String> {
    imp::unregister(app, purpose)
}

#[cfg(desktop)]
fn is_registered_impl(app: &AppHandle, accelerator: &str) -> Result<bool, String> {
    imp::is_registered(app, accelerator)
}

// Mobile stubs. The commands stay in the specta command list on every platform
// so `bindings.ts` is identical everywhere (it is generated on a desktop dev
// machine and committed).
#[cfg(not(desktop))]
const MOBILE_UNSUPPORTED: &str = "Global shortcuts are only supported on desktop";

#[cfg(not(desktop))]
fn register_impl(
    _app: &AppHandle,
    _purpose: ShortcutPurpose,
    _accelerator: String,
) -> Result<(), String> {
    Err(MOBILE_UNSUPPORTED.to_string())
}

#[cfg(not(desktop))]
fn unregister_impl(_app: &AppHandle, _purpose: ShortcutPurpose) -> Result<(), String> {
    Err(MOBILE_UNSUPPORTED.to_string())
}

#[cfg(not(desktop))]
fn is_registered_impl(_app: &AppHandle, _accelerator: &str) -> Result<bool, String> {
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    // `register`/`unregister`/`is_registered` need a live AppHandle and the
    // platform's native hotkey subsystem, neither of which exists under
    // `cargo test` (especially on headless CI). They are covered by the
    // frontend's mockIPC tests for the rollback flow, plus manual QA.

    #[test]
    fn validate_accelerator_rejects_empty() {
        assert!(validate_accelerator("").is_err());
    }

    #[test]
    fn validate_accelerator_rejects_whitespace_only() {
        assert!(validate_accelerator("   ").is_err());
    }

    #[test]
    fn validate_accelerator_accepts_a_real_combo() {
        assert!(validate_accelerator("CmdOrCtrl+Shift+K").is_ok());
    }

    #[cfg(desktop)]
    #[test]
    fn the_default_quick_pane_accelerator_parses() {
        // A default that the hotkey crate cannot parse would fail silently at
        // startup, leaving the pane unreachable on a fresh clone.
        use std::str::FromStr;
        use tauri_plugin_global_shortcut::Shortcut;

        assert!(Shortcut::from_str(crate::types::DEFAULT_QUICK_PANE_SHORTCUT).is_ok());
    }

    #[cfg(desktop)]
    #[test]
    fn equivalent_accelerator_spellings_compare_equal() {
        // The dispatch in `purpose_for` relies on this: what the frontend
        // stores and what the OS reports need not be spelled the same.
        use std::str::FromStr;
        use tauri_plugin_global_shortcut::Shortcut;

        let stored = Shortcut::from_str("CmdOrCtrl+Shift+.").unwrap();
        let fired = Shortcut::from_str("CmdOrCtrl+Shift+Period").unwrap();
        assert_eq!(stored, fired);
    }
}
