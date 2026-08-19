use std::sync::atomic::AtomicBool;

#[derive(Default)]
pub struct AppState {
    pub force_close: AtomicBool,
    pub has_unsaved_changes: AtomicBool,
}
