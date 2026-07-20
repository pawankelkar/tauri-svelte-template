//! The Quick Pane — a small always-on-top window opened by a global shortcut,
//! even while another application has focus.
//!
//! It is a second Vite entry point (`quick-pane.html`) in its own webview, so
//! it shares no Svelte state with the main window; the two talk over Tauri
//! events. See `docs/developer/quick-panes.md`.

use tauri::{
    AppHandle, LogicalSize, Manager, PhysicalPosition, PhysicalSize, WebviewUrl,
    WebviewWindowBuilder,
};

pub const QUICK_PANE_LABEL: &str = "quick-pane";

const WIDTH: f64 = 640.0;
const HEIGHT: f64 = 84.0;

/// How far down the monitor the pane sits, as a fraction of its height.
///
/// Dead centre reads as a modal dialog; a little above centre is the placement
/// people already know from Spotlight and similar launchers.
const TOP_OFFSET_RATIO: f64 = 0.25;

/// Creates the pane's window, hidden, ready to be shown by the shortcut.
///
/// Called from `setup()` rather than exposed over IPC: window creation has to
/// happen on the main thread, and nothing in the frontend should be able to
/// build a second one.
pub fn init_quick_pane(app: &AppHandle) -> Result<(), String> {
    if app.get_webview_window(QUICK_PANE_LABEL).is_some() {
        return Ok(());
    }

    WebviewWindowBuilder::new(
        app,
        QUICK_PANE_LABEL,
        WebviewUrl::App("quick-pane.html".into()),
    )
    .title("Quick Pane")
    .inner_size(WIDTH, HEIGHT)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(true)
    .always_on_top(true)
    .skip_taskbar(true)
    // macOS: lets the pane follow the user across Spaces instead of dragging
    // them back to the one it was created on. No-op elsewhere.
    .visible_on_all_workspaces(true)
    .visible(false)
    .build()
    .map(|_| ())
    .map_err(|e| format!("Failed to create the Quick Pane window: {e}"))
}

/// Where the pane should sit on a given monitor, in physical pixels.
///
/// Pure so the multi-monitor and HiDPI arithmetic — the part that actually goes
/// wrong — is testable without a window.
fn centered_position(
    monitor_position: PhysicalPosition<i32>,
    monitor_size: PhysicalSize<u32>,
    scale_factor: f64,
) -> PhysicalPosition<i32> {
    let pane_width = WIDTH * scale_factor;
    let pane_height = HEIGHT * scale_factor;

    let x = monitor_position.x as f64 + (monitor_size.width as f64 - pane_width) / 2.0;
    let y =
        monitor_position.y as f64 + (monitor_size.height as f64 - pane_height) * TOP_OFFSET_RATIO;

    PhysicalPosition::new(x.round() as i32, y.round() as i32)
}

/// Positions the pane on whichever monitor the cursor is on, then shows it.
#[tauri::command]
#[specta::specta]
pub fn show_quick_pane(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(QUICK_PANE_LABEL)
        .ok_or_else(|| "Quick Pane window does not exist".to_string())?;

    // Multi-monitor: follow the cursor. Every step here is allowed to fail on
    // an exotic setup, so each one falls back to the primary monitor rather
    // than refusing to open the pane.
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());

    if let Some(monitor) = monitor {
        let position =
            centered_position(*monitor.position(), *monitor.size(), monitor.scale_factor());
        let _ = window.set_position(position);
    }

    // Re-asserted on every show: the size is lost if the webview was recreated,
    // and a mis-sized transparent window is invisible rather than obviously
    // broken.
    let _ = window.set_size(LogicalSize::new(WIDTH, HEIGHT));

    window
        .show()
        .map_err(|e| format!("Failed to show the Quick Pane: {e}"))?;
    window
        .set_focus()
        .map_err(|e| format!("Failed to focus the Quick Pane: {e}"))
}

/// Hides the pane.
///
/// Both the blur handler and the submit handler call this, and on some
/// platforms hiding triggers another blur, so the visibility guard keeps the
/// double call harmless.
#[tauri::command]
#[specta::specta]
pub fn dismiss_quick_pane(app: AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window(QUICK_PANE_LABEL) else {
        return Ok(());
    };
    if !window.is_visible().unwrap_or(false) {
        return Ok(());
    }
    window
        .hide()
        .map_err(|e| format!("Failed to hide the Quick Pane: {e}"))
}

#[tauri::command]
#[specta::specta]
pub fn toggle_quick_pane(app: AppHandle) -> Result<(), String> {
    let visible = app
        .get_webview_window(QUICK_PANE_LABEL)
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false);

    if visible {
        dismiss_quick_pane(app)
    } else {
        show_quick_pane(app)
    }
}

/// The toggle entry point for callers that are not IPC — currently the global
/// shortcut handler. Keeps the hotkey, the palette and the menu on one path.
pub fn toggle(app: &AppHandle) {
    if let Err(e) = toggle_quick_pane(app.clone()) {
        log::warn!("Quick Pane toggle failed: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn centers_horizontally_on_the_primary_monitor() {
        let position = centered_position(
            PhysicalPosition::new(0, 0),
            PhysicalSize::new(1920, 1080),
            1.0,
        );
        assert_eq!(position.x, ((1920.0 - WIDTH) / 2.0).round() as i32);
        assert_eq!(
            position.y,
            ((1080.0 - HEIGHT) * TOP_OFFSET_RATIO).round() as i32
        );
    }

    #[test]
    fn honours_a_monitor_origin_left_of_the_primary() {
        // Secondary monitors placed to the left have negative origins, which is
        // the classic off-by-a-whole-screen bug.
        let position = centered_position(
            PhysicalPosition::new(-1920, 0),
            PhysicalSize::new(1920, 1080),
            1.0,
        );
        assert_eq!(position.x, -1920 + ((1920.0 - WIDTH) / 2.0).round() as i32);
    }

    #[test]
    fn scales_the_pane_size_on_a_hidpi_monitor() {
        // The pane's size is logical; the monitor reports physical pixels, so a
        // 2x display needs the doubled pane width subtracted, not the raw one.
        let position = centered_position(
            PhysicalPosition::new(0, 0),
            PhysicalSize::new(3840, 2160),
            2.0,
        );
        assert_eq!(position.x, ((3840.0 - WIDTH * 2.0) / 2.0).round() as i32);
        assert_eq!(
            position.y,
            ((2160.0 - HEIGHT * 2.0) * TOP_OFFSET_RATIO).round() as i32
        );
    }

    #[test]
    fn stays_on_screen_when_the_monitor_is_narrow() {
        let position = centered_position(
            PhysicalPosition::new(0, 0),
            PhysicalSize::new(1280, 720),
            1.0,
        );
        assert!(position.x >= 0);
        assert!(position.y >= 0);
    }
}
