use std::sync::atomic::Ordering;

use tauri::State;

use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub fn confirm_close(state: State<AppState>) {
    state.force_close.store(true, Ordering::SeqCst);
}
