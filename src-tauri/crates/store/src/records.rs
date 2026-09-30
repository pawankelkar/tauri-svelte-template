//! Plain data passed in and out of the repositories.
//!
//! These mirror the tables, not the IPC types: the app maps its parsed notes
//! into them and maps query results back into its own serialisable structs.
//! Paths are vault-relative and `/`-separated; times are ms since the epoch.

/// One markdown file, as written by [`notes::upsert`](crate::repo::notes::upsert).
#[derive(Debug, Clone, PartialEq)]
pub struct NoteRecord {
    pub path: String,
    pub title: String,
    /// blake3 hex of the file contents.
    pub hash: String,
    pub mtime: f64,
    pub size: u64,
    /// Frontmatter serialised as JSON, if the note has any.
    pub frontmatter: Option<String>,
}

/// A stored note, as read back.
#[derive(Debug, Clone, PartialEq)]
pub struct NoteRow {
    pub id: i64,
    pub path: String,
    pub title: String,
    pub hash: String,
    pub mtime: f64,
    pub size: Option<u64>,
    pub frontmatter: Option<String>,
    /// When the row was last written.
    pub indexed_at: Option<f64>,
}

/// The cheap subset of a note used for change detection and quick open.
#[derive(Debug, Clone, PartialEq)]
pub struct NoteMeta {
    pub path: String,
    pub title: String,
    pub mtime: f64,
    pub hash: String,
}

/// One `[[wiki link]]`, `![[embed]]` or markdown link out of a note.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkRecord {
    /// The target as written, without `#heading` and `|alias`.
    pub target_raw: String,
    /// The vault path it resolved to, or `None` while unresolved.
    pub target_path: Option<String>,
    pub heading: Option<String>,
    pub alias: Option<String>,
    pub is_embed: bool,
    /// 0-based line of the link in the source note.
    pub line: u32,
    /// The source line, trimmed (the caller caps its length).
    pub context: String,
}

/// A note linking to the queried path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BacklinkRow {
    pub source_path: String,
    pub source_title: String,
    pub line: u32,
    pub context: String,
}

/// One stored link with its row id, for re-resolving links in bulk after
/// the set of notes changed (see [`links::targets`](crate::repo::links::targets)).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkTargetRow {
    /// The link's row id, for [`links::set_target_by_id`](crate::repo::links::set_target_by_id).
    pub id: i64,
    pub source_path: String,
    pub target_raw: String,
    pub target_path: Option<String>,
}

/// A link whose target didn't resolve to any note.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnresolvedLink {
    pub source_path: String,
    pub target_raw: String,
    pub line: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HeadingRecord {
    pub level: u32,
    pub text: String,
    pub slug: String,
    /// 0-based.
    pub line: u32,
}

/// A `- [ ]` / `- [x]` item.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TaskRecord {
    /// 0-based.
    pub line: u32,
    pub text: String,
    pub done: bool,
}

/// A tag and how many notes carry it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TagCount {
    pub tag: String,
    pub count: u32,
}

/// What [`Db::stats`](crate::Db::stats) reports.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DbStats {
    /// `PRAGMA user_version`: the number of migrations applied.
    pub schema_version: u32,
    pub note_count: u32,
    /// The database file plus its write-ahead log.
    pub size_bytes: u64,
}
