use std::sync::Mutex;

use tauri::AppHandle;

use crate::commands::preferences::load_global_shortcut;

/// The accelerator currently registered with the OS, if any.
///
/// Tracked here so `unregister_global_shortcut` knows what to release without
/// the frontend having to tell it. Phase 6 adds a second global shortcut (the
/// Quick Pane toggle) — when it lands, this single slot becomes a map keyed by
/// purpose rather than a bare `Option`.
static CURRENT_SHORTCUT: Mutex<Option<String>> = Mutex::new(None);

fn validate_accelerator(accelerator: &str) -> Result<(), String> {
    if accelerator.trim().is_empty() {
        return Err("Accelerator must not be empty".to_string());
    }
    Ok(())
}

/// Registers `accelerator` with the OS, replacing whatever this module had
/// registered before. No-ops when the accelerator is already the current one.
#[tauri::command]
#[specta::specta]
pub fn register_global_shortcut(app: AppHandle, accelerator: String) -> Result<(), String> {
    validate_accelerator(&accelerator)?;
    register_impl(&app, accelerator)
}

/// Releases the accelerator this module currently holds, if any.
#[tauri::command]
#[specta::specta]
pub fn unregister_global_shortcut(app: AppHandle) -> Result<(), String> {
    unregister_impl(&app)
}

#[tauri::command]
#[specta::specta]
pub fn is_global_shortcut_registered(app: AppHandle, accelerator: String) -> Result<bool, String> {
    is_registered_impl(&app, &accelerator)
}

/// Registers the user's saved shortcut during `setup()`.
///
/// Deliberately non-fatal: a stale accelerator, or one another application has
/// already claimed, must never prevent the app from starting.
pub fn register_saved_shortcut_on_startup(app: &AppHandle) {
    let Some(accelerator) = load_global_shortcut(app) else {
        return;
    };
    if let Err(e) = register_impl(app, accelerator.clone()) {
        log::warn!("Could not register saved global shortcut '{accelerator}': {e}");
    }
}

#[cfg(desktop)]
mod imp {
    use super::{AppHandle, CURRENT_SHORTCUT};
    use tauri::Manager;
    use tauri_plugin_global_shortcut::{
        GlobalShortcutExt, Shortcut, ShortcutEvent, ShortcutState,
    };

    /// The action bound to the user's global shortcut.
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

    /// Installed once via `Builder::with_handler` in `lib.rs`; fires for every
    /// accelerator registered through this module.
    pub fn handle_shortcut_event(app: &AppHandle, _shortcut: &Shortcut, event: ShortcutEvent) {
        if matches!(event.state, ShortcutState::Pressed) {
            focus_main_window(app);
        }
    }

    pub fn register(app: &AppHandle, accelerator: String) -> Result<(), String> {
        let mut current = CURRENT_SHORTCUT
            .lock()
            .map_err(|e| format!("Shortcut state poisoned: {e}"))?;

        if current.as_deref() == Some(accelerator.as_str()) {
            return Ok(());
        }
        if let Some(previous) = current.as_deref() {
            let _ = app.global_shortcut().unregister(previous);
        }
        app.global_shortcut()
            .register(accelerator.as_str())
            .map_err(|e| format!("Failed to register shortcut '{accelerator}': {e}"))?;

        *current = Some(accelerator);
        Ok(())
    }

    pub fn unregister(app: &AppHandle) -> Result<(), String> {
        let mut current = CURRENT_SHORTCUT
            .lock()
            .map_err(|e| format!("Shortcut state poisoned: {e}"))?;

        if let Some(accelerator) = current.as_deref() {
            app.global_shortcut()
                .unregister(accelerator)
                .map_err(|e| format!("Failed to unregister shortcut '{accelerator}': {e}"))?;
        }
        *current = None;
        Ok(())
    }

    pub fn is_registered(app: &AppHandle, accelerator: &str) -> Result<bool, String> {
        Ok(app.global_shortcut().is_registered(accelerator))
    }
}

#[cfg(desktop)]
pub use imp::handle_shortcut_event;

#[cfg(desktop)]
fn register_impl(app: &AppHandle, accelerator: String) -> Result<(), String> {
    imp::register(app, accelerator)
}

#[cfg(desktop)]
fn unregister_impl(app: &AppHandle) -> Result<(), String> {
    imp::unregister(app)
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
fn register_impl(_app: &AppHandle, _accelerator: String) -> Result<(), String> {
    Err(MOBILE_UNSUPPORTED.to_string())
}

#[cfg(not(desktop))]
fn unregister_impl(_app: &AppHandle) -> Result<(), String> {
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
}
