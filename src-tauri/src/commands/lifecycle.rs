use std::sync::atomic::Ordering;

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::state::AppState;

/// Payload of the `app:close-requested` event.
///
/// The window manager asks Rust to close, but only the frontend knows how to
/// flush its stores — so Rust prevents the close, tells the frontend what the
/// close should ultimately *mean* on this platform, and lets it finish the job.
#[derive(Debug, Clone, Serialize)]
pub struct CloseRequest {
    /// macOS convention: closing the last window leaves the application
    /// running, reachable from the dock. Everywhere else, close means quit.
    pub hide: bool,
}

impl CloseRequest {
    pub fn for_current_platform() -> Self {
        Self {
            hide: cfg!(target_os = "macos"),
        }
    }
}

#[tauri::command]
#[specta::specta]
pub fn confirm_close(state: State<AppState>) {
    state.force_close.store(true, Ordering::SeqCst);
}

/// Quits for real, whatever the platform's close convention is.
///
/// On macOS the main window's close button only hides, so the Quit menu item
/// and the `app-quit` command need a path that actually ends the process. The
/// frontend flushes its stores before calling this.
#[tauri::command]
#[specta::specta]
pub fn quit_app(app: AppHandle, state: State<AppState>) {
    // Set first: teardown closes the windows, and the close handler must not
    // intercept those and re-run the handshake.
    state.force_close.store(true, Ordering::SeqCst);
    app.exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn close_request_hides_only_on_macos() {
        assert_eq!(
            CloseRequest::for_current_platform().hide,
            cfg!(target_os = "macos")
        );
    }
}
