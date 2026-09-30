//! Offline mode and the network activity log.
//!
//! The policy itself lives in `ostralith-net`; this module loads it from
//! `network.json` at startup, hands the resulting [`NetClient`] to Tauri as
//! managed state, and exposes the few knobs the UI needs.

use std::sync::Mutex;

use ostralith_core::CoreError;
use ostralith_net::{NetClient, NetPolicy, RequestRecord};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

use crate::commands::json_store::{data_file_path, load_json, save_json};

const NETWORK_FILE: &str = "network.json";

/// Emitted with the new [`NetPolicy`] whenever it changes, so every window
/// (and the status bar) can follow without polling.
pub const POLICY_CHANGED_EVENT: &str = "network:policy-changed";

/// Serialises read-modify-write updates of the policy, so two toggles in
/// flight can't persist one state and apply the other.
static WRITE_LOCK: Mutex<()> = Mutex::new(());

/// Builds the app's [`NetClient`] from the saved policy and manages it. Must
/// run in `setup()`, before any command that takes `State<NetClient>`.
pub fn init_network<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let policy: NetPolicy = match data_file_path(app, NETWORK_FILE) {
        Ok(path) => load_json(&path),
        Err(e) => {
            log::warn!("Network policy unavailable, starting offline: {e}");
            NetPolicy::default()
        }
    };
    log::info!(
        "Network policy: offline={}, allow_localhost={}",
        policy.offline,
        policy.allow_localhost
    );
    let client = NetClient::new(policy).map_err(|e| e.to_string())?;
    app.manage(client);
    Ok(())
}

fn update_policy<R: Runtime>(
    app: &AppHandle<R>,
    net: &NetClient,
    change: impl FnOnce(&mut NetPolicy),
) -> Result<NetPolicy, CoreError> {
    let _guard = WRITE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut policy = net.policy();
    change(&mut policy);
    // Persist first: if the write fails the live policy stays as it was,
    // so what the user sees never disagrees with what survives a restart.
    save_json(&data_file_path(app, NETWORK_FILE)?, &policy)?;
    net.set_policy(policy.clone());
    if let Err(e) = app.emit(POLICY_CHANGED_EVENT, &policy) {
        log::warn!("Could not broadcast the network policy: {e}");
    }
    Ok(policy)
}

#[tauri::command]
#[specta::specta]
pub fn get_network_status(net: State<'_, NetClient>) -> NetPolicy {
    net.policy()
}

#[tauri::command]
#[specta::specta]
pub fn set_offline_mode(
    app: AppHandle,
    net: State<'_, NetClient>,
    offline: bool,
) -> Result<NetPolicy, CoreError> {
    let policy = update_policy(&app, &net, |p| p.offline = offline)?;
    log::info!("Offline mode {}", if offline { "on" } else { "off" });
    Ok(policy)
}

#[tauri::command]
#[specta::specta]
pub fn set_allow_localhost(
    app: AppHandle,
    net: State<'_, NetClient>,
    allow: bool,
) -> Result<NetPolicy, CoreError> {
    update_policy(&app, &net, |p| p.allow_localhost = allow)
}

/// Every request attempt since launch, newest first.
#[tauri::command]
#[specta::specta]
pub fn list_network_activity(net: State<'_, NetClient>) -> Vec<RequestRecord> {
    let mut records = net.activity();
    records.reverse();
    records
}

#[tauri::command]
#[specta::specta]
pub fn clear_network_activity(net: State<'_, NetClient>) {
    net.clear_activity();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::test_support::{json_round_trip, scratch_dir};

    #[test]
    fn policy_file_round_trips() {
        let policy = NetPolicy {
            offline: false,
            allow_localhost: false,
            allowed_hosts: vec!["huggingface.co".into()],
        };
        let loaded = json_round_trip("network", "roundtrip", NETWORK_FILE, &policy);
        assert_eq!(loaded, policy);
    }

    #[test]
    fn a_missing_file_means_offline() {
        let dir = scratch_dir("network", "missing");
        let policy: NetPolicy = load_json(&dir.join(NETWORK_FILE));
        assert!(policy.offline);
        assert!(policy.allow_localhost);
    }
}
