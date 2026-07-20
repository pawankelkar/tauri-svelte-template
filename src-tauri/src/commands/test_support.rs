//! Test-only helpers shared by the command modules.
//!
//! Compiled out of release builds entirely — `mod.rs` gates the module behind
//! `#[cfg(test)]`.

use std::fs;
use std::path::PathBuf;

/// Returns an empty scratch directory, unique to this module and test.
///
/// The process id is part of the name so that concurrently running test
/// binaries never collide, and any leftovers from a previous run are cleared
/// before the directory is handed back.
pub fn scratch_dir(module: &str, name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "tauri-app-{module}-test-{name}-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}
