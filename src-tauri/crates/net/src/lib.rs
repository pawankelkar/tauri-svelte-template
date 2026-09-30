//! Outbound networking for Ostralith.
//!
//! [`NetClient`] is the only way the app talks to the network. Every request
//! is checked against a [`NetPolicy`] before any IO happens — offline mode
//! blocks all non-loopback hosts, and online requests must match the host
//! allowlist — and every attempt, allowed or blocked, lands in the activity
//! log the Privacy settings pane shows. Redirects are re-checked hop by hop,
//! so an allowed host can't bounce a request somewhere the policy forbids.
//!
//! `src-tauri/clippy.toml` forbids constructing a `reqwest` client anywhere
//! else, and the frontend CSP plus the `no-fetch` ast-grep rule keep the
//! webview from making its own requests.

mod activity;
mod client;
mod error;
mod policy;

pub use activity::{RequestOutcome, RequestRecord};
pub use client::NetClient;
pub use error::NetError;
pub use policy::NetPolicy;

/// Re-exported so callers can build requests without depending on `reqwest`
/// directly (and without being able to build their own client).
pub use reqwest::{header, Method, Request, Response};
