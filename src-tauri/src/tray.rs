//! Minimal tray icon: left-click shows/focuses the main window, menu with
//! Show/Quit. Built entirely in Rust — no JS IPC, so no capability changes.

use tauri::{
    menu::{MenuBuilder, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};

/// Brings the main window forward.
///
/// Duplicates the body of `focus_main_window` in
/// `commands/global_shortcut.rs` — three lines of window calls aren't worth an
/// abstraction shared across modules (locality over abstraction).
fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Creates the tray icon. Called from `setup()`; non-fatal at the call site —
/// the app works fine without a tray, so a failure is logged, not fatal.
pub fn init_tray(app: &AppHandle) -> Result<(), String> {
    // OS-native menu, not routed through i18next: static English labels are
    // the accepted limitation (the webview's translations aren't available to
    // native menus without extra plumbing).
    let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)
        .map_err(|e| format!("Failed to create the tray Show item: {e}"))?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)
        .map_err(|e| format!("Failed to create the tray Quit item: {e}"))?;
    let separator = PredefinedMenuItem::separator(app)
        .map_err(|e| format!("Failed to create the tray separator: {e}"))?;
    let menu = MenuBuilder::new(app)
        .items(&[&show, &separator, &quit])
        .build()
        .map_err(|e| format!("Failed to build the tray menu: {e}"))?;

    let builder = TrayIconBuilder::with_id("main-tray")
        .icon(
            app.default_window_icon()
                .cloned()
                .ok_or("No default window icon available for the tray")?,
        )
        .tooltip(&app.package_info().name)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main_window(app),
            // Never app.exit() directly: the frontend flushes its stores and
            // then calls quit_app, the same handshake the command palette and
            // the window close button use.
            "quit" => {
                let _ = app.emit("tray:quit-requested", ());
            }
            _ => {}
        });

    // The colored default icon becomes an auto-tinted silhouette in the macOS
    // menu bar; shipping apps should provide a dedicated monochrome tray asset.
    #[cfg(target_os = "macos")]
    let builder = builder.icon_as_template(true);

    builder
        .build(app)
        .map(|_| ())
        .map_err(|e| format!("Failed to create the tray icon: {e}"))
}
