use std::sync::atomic::AtomicBool;

#[derive(Default)]
pub struct AppState {
    pub force_close: AtomicBool,
}
