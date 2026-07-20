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
        .manage(AppState::default())
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<AppState>();
                if !state.force_close.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.emit("app:close-requested", ());
                }
            }
        })
        .setup(|app| {
            log::info!("Application starting up");
            log::debug!(
                "App handle initialized for package: {}",
                app.package_info().name
            );
            Ok(())
        })
        .invoke_handler(builder.invoke_handler())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
