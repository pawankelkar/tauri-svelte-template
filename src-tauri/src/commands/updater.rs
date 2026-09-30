//! Update checks, routed through the network policy.
//!
//! The Tauri updater plugin ships its own HTTP client, so the frontend never
//! calls it directly: these commands first run every configured endpoint
//! through [`NetClient::authorize_external`] (offline mode and the allowlist
//! apply, and the attempt shows up in the activity log), then let the plugin
//! do the transfer. Checks only ever happen when the user asks for one.

use ostralith_core::CoreError;
use ostralith_net::NetClient;
use serde::Serialize;
use specta::Type;
use tauri::{AppHandle, State};

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    pub notes: Option<String>,
}

/// The update found by the last `check_for_update`, kept until it is
/// installed so the frontend never has to hold a handle to it.
#[derive(Default)]
pub struct PendingUpdate(#[allow(dead_code)] std::sync::Mutex<Option<PendingHandle>>);

#[cfg(desktop)]
type PendingHandle = tauri_plugin_updater::Update;
#[cfg(not(desktop))]
type PendingHandle = ();

/// The endpoints from `plugins.updater.endpoints` in tauri.conf.json.
#[cfg_attr(not(desktop), allow(dead_code))]
fn configured_endpoints(app: &AppHandle) -> Vec<String> {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|u| u.get("endpoints"))
        .and_then(|e| e.as_array())
        .map(|list| {
            list.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

/// Fills in the `{{target}}`, `{{arch}}` and `{{current_version}}`
/// placeholders the way the updater plugin does before it sends, so the
/// activity log shows the URL that is actually requested rather than the
/// template. `{{bundle_type}}` is left alone: the plugin resolves it from the
/// installed bundle, which isn't knowable here.
#[cfg_attr(not(desktop), allow(dead_code))]
fn resolve_endpoint(endpoint: &str, current_version: &str) -> String {
    let target = if cfg!(target_os = "macos") {
        "darwin"
    } else {
        std::env::consts::OS
    };
    let arch = match std::env::consts::ARCH {
        "x86" => "i686",
        "arm" => "armv7",
        other => other,
    };
    endpoint
        .replace("{{current_version}}", current_version)
        .replace("{{target}}", target)
        .replace("{{arch}}", arch)
}

#[cfg(desktop)]
mod platform {
    use super::*;
    use tauri_plugin_updater::UpdaterExt;

    pub async fn check(
        app: &AppHandle,
        net: &NetClient,
        pending: &PendingUpdate,
    ) -> Result<Option<UpdateInfo>, CoreError> {
        let endpoints = configured_endpoints(app);
        if endpoints.is_empty() {
            return Err(CoreError::feature_disabled(
                "updates",
                "no update endpoint is configured",
            ));
        }
        let version = app.package_info().version.to_string();
        for endpoint in &endpoints {
            net.authorize_external("GET", &resolve_endpoint(endpoint, &version), "updater")?;
        }

        let update = app
            .updater()
            .map_err(|e| CoreError::from(e.to_string()))?
            .check()
            .await
            .map_err(|e| CoreError::Network {
                message: e.to_string(),
            })?;

        let info = update.as_ref().map(|u| UpdateInfo {
            version: u.version.clone(),
            current_version: u.current_version.clone(),
            notes: u.body.clone(),
        });
        *pending.0.lock().unwrap_or_else(|e| e.into_inner()) = update;
        Ok(info)
    }

    pub async fn install(
        app: &AppHandle,
        net: &NetClient,
        pending: &PendingUpdate,
    ) -> Result<(), CoreError> {
        let update = pending
            .0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take()
            .ok_or_else(|| CoreError::invalid_input("no update is pending; check first"))?;
        net.authorize_external("GET", update.download_url.as_str(), "updater")?;
        update
            .download_and_install(|_, _| {}, || {})
            .await
            .map_err(|e| CoreError::Network {
                message: e.to_string(),
            })?;
        log::info!("Update installed, restarting");
        app.restart();
    }
}

#[cfg(not(desktop))]
mod platform {
    use super::*;

    pub async fn check(
        _app: &AppHandle,
        _net: &NetClient,
        _pending: &PendingUpdate,
    ) -> Result<Option<UpdateInfo>, CoreError> {
        Err(CoreError::feature_disabled(
            "updates",
            "not supported on this platform",
        ))
    }

    pub async fn install(
        _app: &AppHandle,
        _net: &NetClient,
        _pending: &PendingUpdate,
    ) -> Result<(), CoreError> {
        Err(CoreError::feature_disabled(
            "updates",
            "not supported on this platform",
        ))
    }
}

#[tauri::command]
#[specta::specta]
pub async fn check_for_update(
    app: AppHandle,
    net: State<'_, NetClient>,
    pending: State<'_, PendingUpdate>,
) -> Result<Option<UpdateInfo>, CoreError> {
    platform::check(&app, &net, &pending).await
}

/// Downloads and installs the pending update, then restarts the app. Only
/// returns on failure.
#[tauri::command]
#[specta::specta]
pub async fn install_update(
    app: AppHandle,
    net: State<'_, NetClient>,
    pending: State<'_, PendingUpdate>,
) -> Result<(), CoreError> {
    platform::install(&app, &net, &pending).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_endpoint_fills_every_placeholder() {
        let url = resolve_endpoint(
            "https://updates.example.invalid/{{target}}/{{arch}}/{{current_version}}",
            "1.2.3",
        );
        assert!(!url.contains("{{"), "unresolved placeholder in {url}");
        assert!(url.ends_with("/1.2.3"));
        if cfg!(target_os = "macos") {
            assert!(url.contains("/darwin/"));
        }
    }

    #[test]
    fn resolve_endpoint_leaves_plain_urls_alone() {
        let url = "https://updates.example.invalid/latest.json";
        assert_eq!(resolve_endpoint(url, "1.2.3"), url);
    }
}
