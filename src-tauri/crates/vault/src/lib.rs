//! The Ostralith vault: a folder of Markdown files that is the source of
//! truth for a user's notes.
//!
//! - [`Vault`] opens or initialises a folder (`.ostralith/vault.json` holds
//!   its stable id).
//! - [`VaultFs`] does every file operation through vault-relative
//!   [`RelPath`]s, checks that each resolved path stays inside the vault
//!   (symlinks included), writes atomically with optional conflict
//!   detection, and never deletes: [`VaultFs::trash`] moves to `.trash/`.
//! - [`parse::parse_note`] extracts frontmatter, title, headings, links,
//!   tags, tasks and block ids for indexing.
//! - [`links`] resolves links with Obsidian semantics and rewrites them when
//!   notes or folders are renamed.
//! - [`watcher::VaultWatcher`] reports external edits, ignoring the vault's
//!   own writes via the shared [`RecentWrites`] set.
//!
//! Everything is synchronous; the app calls it from `spawn_blocking`.

mod error;
mod fs;
pub mod links;
pub mod parse;
mod path;
mod recent;
mod sort;
mod vault;
pub mod watcher;

pub use error::{VaultError, VaultResult};
pub use fs::{
    hash_bytes, is_hidden_name, EntryKind, FileContent, NoteEntry, TreeEntry, VaultFs,
    WriteOutcome, META_DIR, TMP_PREFIX, TRASH_DIR,
};
pub use links::{rename_with_links, RenameReport};
pub use parse::{parse_note, strip_frontmatter, ParsedNote};
pub use path::{RelPath, MAX_PATH_LEN, MAX_SEGMENT_LEN};
pub use recent::{Expected, RecentWrites};
pub use sort::natural_cmp;
pub use vault::{Vault, VaultMarker, MARKER_VERSION};
pub use watcher::{FsChange, FsChangeKind, VaultWatcher};
