mod bindings;
mod commands;
mod state;
mod types;

use std::sync::atomic::Ordering;

use tauri::{Emitter, Manager, WindowEvent};

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = bindings::generate_bindings();

    #[cfg(debug_assertions)]
    bindings::export_ts_bindings();

    let mut app_builder = tauri::Builder::default();

    // Single instance — must be registered FIRST
    #[cfg(desktop)]
    {
        app_builder = app_builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
                let _ = window.unminimize();
            }
        }));
    }

    // Window state — saves/restores position and size
    #[cfg(desktop)]
    {
        use tauri_plugin_window_state::StateFlags;

        app_builder = app_builder.plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(
                    StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED,
                )
                .with_denylist(&["quick-pane"])
                .build(),
        );
    }

    // Global shortcut — one handler for every accelerator this app registers.
    // Registration itself happens in setup() from the saved preference, and at
    // runtime through the commands in commands/global_shortcut.rs.
    #[cfg(desktop)]
    {
        app_builder = app_builder.plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(commands::global_shortcut::handle_shortcut_event)
                .build(),
        );
    }

    app_builder = app_builder.plugin({
        #[allow(unused_mut)]
        let mut targets = vec![
            tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
            #[cfg(target_os = "macos")]
            tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                file_name: None,
            }),
        ];
        // Excluded on Linux where WebKitGTK's webview doesn't exist during
        // setup(), causing app.emit() to deadlock on the IPC socket.
        #[cfg(not(target_os = "linux"))]
        targets.push(tauri_plugin_log::Target::new(
            tauri_plugin_log::TargetKind::Webview,
        ));
        tauri_plugin_log::Builder::new()
            .level(if cfg!(debug_assertions) {
                log::LevelFilter::Debug
            } else {
                log::LevelFilter::Info
            })
            .targets(targets)
            .build()
    });

    app_builder
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .manage(AppState::default())
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Only the main window runs the handshake. The Quick Pane is
                // dismissed, never closed, and must not trigger a store flush.
                if window.label() != "main" {
                    return;
                }
                let state = window.state::<AppState>();
                if !state.force_close.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.emit(
                        "app:close-requested",
                        commands::lifecycle::CloseRequest::for_current_platform(),
                    );
                }
            }
        })
        .setup(|app| {
            log::info!("Application starting up");
            log::debug!(
                "App handle initialized for package: {}",
                app.package_info().name
            );

            #[cfg(desktop)]
            commands::global_shortcut::register_saved_shortcuts_on_startup(app.handle());

            // Non-fatal: the app is perfectly usable without the Quick Pane, so
            // a window-creation failure is logged rather than aborting startup.
            if let Err(e) = commands::quick_pane::init_quick_pane(app.handle()) {
                log::warn!("Quick Pane unavailable: {e}");
            }

            Ok(())
        })
        .invoke_handler(builder.invoke_handler())
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| match event {
            // macOS keeps the process alive after the last window closes, so a
            // dock-icon click has to bring the main window back itself.
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => {
                if let Some(window) = _app_handle.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            tauri::RunEvent::Exit => {
                #[cfg(desktop)]
                commands::global_shortcut::unregister_all(_app_handle);
            }
            _ => {}
        });
}
