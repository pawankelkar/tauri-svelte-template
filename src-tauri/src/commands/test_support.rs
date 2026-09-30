//! Test-only helpers shared by the command modules.
//!
//! Compiled out of release builds entirely — `mod.rs` gates the module behind
//! `#[cfg(test)]`.

use std::fs;
use std::path::PathBuf;

use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::commands::json_store::{load_json, save_json};

/// Returns an empty scratch directory, unique to this module and test.
///
/// The process id is part of the name so that concurrently running test
/// binaries never collide, and any leftovers from a previous run are cleared
/// before the directory is handed back.
pub fn scratch_dir(module: &str, name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "ostralith-{module}-test-{name}-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

/// Saves `value` through the JSON store into `file` inside a fresh scratch
/// directory, then loads it back. The store every command module persists
/// through, exercised the same way everywhere.
pub fn json_round_trip<T>(module: &str, name: &str, file: &str, value: &T) -> T
where
    T: Serialize + DeserializeOwned + Default,
{
    let path = scratch_dir(module, name).join(file);
    save_json(&path, value).unwrap();
    load_json(&path)
}
