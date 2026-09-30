//! Local Pro feature flags, persisted as `entitlements.json`.
//!
//! There is no licence server: a flag is on because the user (or a build)
//! switched it on. Commands behind a Pro feature call
//! [`require`] with the managed state before doing any work.

use std::sync::RwLock;

use ostralith_core::{CoreError, Entitlements, FeatureEntitlement, ProFeature};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

use crate::commands::json_store::{data_file_path, load_json, save_json};

const ENTITLEMENTS_FILE: &str = "entitlements.json";

pub const ENTITLEMENTS_CHANGED_EVENT: &str = "entitlements:changed";

#[derive(Default)]
pub struct EntitlementsState(RwLock<Entitlements>);

impl EntitlementsState {
    pub fn get(&self) -> Entitlements {
        self.0.read().unwrap_or_else(|e| e.into_inner()).clone()
    }
}

/// `Ok(())` when `feature` is switched on. The guard for Pro commands.
#[allow(dead_code)] // First caller arrives with the first Pro feature (P4).
pub fn require(state: &EntitlementsState, feature: ProFeature) -> Result<(), CoreError> {
    state.get().require(feature)
}

pub fn init_entitlements<R: Runtime>(app: &AppHandle<R>) {
    let entitlements: Entitlements = match data_file_path(app, ENTITLEMENTS_FILE) {
        Ok(path) => load_json(&path),
        Err(e) => {
            log::warn!("Entitlements unavailable, Pro features off: {e}");
            Entitlements::default()
        }
    };
    app.manage(EntitlementsState(RwLock::new(entitlements)));
}

#[tauri::command]
#[specta::specta]
pub fn get_entitlements(state: State<'_, EntitlementsState>) -> Vec<FeatureEntitlement> {
    state.get().list()
}

#[tauri::command]
#[specta::specta]
pub fn set_entitlement(
    app: AppHandle,
    state: State<'_, EntitlementsState>,
    feature: ProFeature,
    enabled: bool,
) -> Result<Vec<FeatureEntitlement>, CoreError> {
    let list = {
        let mut current = state.0.write().unwrap_or_else(|e| e.into_inner());
        let mut next = current.clone();
        next.set(feature, enabled);
        save_json(&data_file_path(&app, ENTITLEMENTS_FILE)?, &next)?;
        *current = next;
        current.list()
    };
    if let Err(e) = app.emit(ENTITLEMENTS_CHANGED_EVENT, &list) {
        log::warn!("Could not broadcast entitlements: {e}");
    }
    Ok(list)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::test_support::json_round_trip;

    #[test]
    fn require_follows_the_state() {
        let state = EntitlementsState::default();
        assert_eq!(
            require(&state, ProFeature::PdfAiQa),
            Err(CoreError::NotEntitled {
                feature: ProFeature::PdfAiQa
            })
        );
        state.0.write().unwrap().set(ProFeature::PdfAiQa, true);
        assert_eq!(require(&state, ProFeature::PdfAiQa), Ok(()));
    }

    #[test]
    fn file_round_trips() {
        let mut e = Entitlements::default();
        e.set(ProFeature::RealtimeTranslation, true);
        let loaded = json_round_trip("entitlements", "roundtrip", ENTITLEMENTS_FILE, &e);
        assert_eq!(loaded, e);
    }
}
