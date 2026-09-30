//! Git backup for Ostralith vaults.
//!
//! [`git::GitBackup`] turns a vault folder into a git repository, takes
//! snapshots (commits), lists a note's history, reads old revisions and
//! pushes to / pulls from an optional `origin`.
//!
//! Everything is synchronous (libgit2); the app wraps calls in
//! `spawn_blocking`. Only `push`, `fetch` and `pull` touch the network, and
//! only after the app has authorized the remote with
//! `NetClient::authorize_external` (see [`git::authorization_url`]).

pub mod error;
pub mod git;

pub use error::{Result, SyncError};
pub use git::{
    authorization_url, Credentials, Divergence, GitBackup, PullOutcome, Snapshot, Status,
};
