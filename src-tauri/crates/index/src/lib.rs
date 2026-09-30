//! Search for Ostralith vaults.
//!
//! - [`SearchIndex`]: tantivy full-text search over note title, headings,
//!   body and tags, with a forgiving query language (see [`query`]) and
//!   highlighted snippets.
//! - [`quick_open`]: fuzzy ranking of note titles and paths for the
//!   quick-open palette. Pure, no index needed.
//!
//! Both return highlights as [`TextPart`] segments rather than offsets, so
//! the UI never converts between UTF-8 and UTF-16 positions.
//!
//! The index is a rebuildable cache: markdown files are the source of truth
//! and this crate never touches the vault. The caller parses notes into
//! [`NoteDoc`]s.

mod error;
mod index;
pub mod query;
pub mod quick_open;
mod schema;
mod text;

pub use error::{IndexError, Result};
pub use index::{Hit, NoteDoc, SearchIndex, MAX_RESULTS, SNIPPET_MAX_CHARS};
pub use quick_open::{QuickOpenCandidate, QuickOpenMatch};
pub use text::{join_parts, TextPart};
