//! Types shared by every Ostralith crate and by the Tauri command layer.
//!
//! Nothing in here does IO. Crates that do (net, store, vault, …) depend on
//! this one for the error vocabulary the frontend understands, so a
//! `NotEntitled` from the AI runtime and one from the PDF plugin look the same
//! over IPC.

mod entitlements;
mod error;

pub use entitlements::{Entitlements, FeatureEntitlement, ProFeature};
pub use error::{CoreError, CoreResult};
