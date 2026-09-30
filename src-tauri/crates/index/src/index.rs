//! [`SearchIndex`]: the tantivy full-text index over a vault's notes.

use std::collections::BTreeMap;
use std::fmt;
use std::fs;
use std::ops::Bound;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};

use tantivy::collector::TopDocs;
use tantivy::query::{AllQuery, RangeQuery};
use tantivy::schema::{Schema, Value};
use tantivy::snippet::SnippetGenerator;
use tantivy::{
    DocAddress, Index, IndexReader, IndexWriter, Order, ReloadPolicy, Searcher, TantivyDocument,
    TantivyError, Term,
};

use crate::error::{IndexError, Result};
use crate::query::{self, BuiltQuery};
use crate::schema::{
    build_schema, lowercase_path, normalize_tag, note_analyzer, register_analyzers, Fields,
    SCHEMA_VERSION,
};
use crate::text::{parts_from_byte_ranges, plain_parts, TextPart};

/// Indexing heap shared by the writer's threads.
const WRITER_HEAP_BYTES: usize = 50_000_000;
/// Smallest heap tantivy accepts for a single-threaded writer.
const IN_MEMORY_HEAP_BYTES: usize = 15_000_000;
/// Snippet length, in bytes of the source text (≈ chars for Latin text).
pub const SNIPPET_MAX_CHARS: usize = 160;
/// Hard cap on `search` results, whatever the caller asks for.
pub const MAX_RESULTS: usize = 1_000;
/// Written next to the index; see [`SCHEMA_VERSION`].
const VERSION_FILE: &str = "ostralith-index-version";

/// One note as the index sees it. The caller parses the markdown; this crate
/// never reads the vault.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct NoteDoc {
    /// Vault-relative, `/`-separated path. The document key.
    pub path: String,
    pub title: String,
    pub headings: Vec<String>,
    /// Text used for matching and snippets. Pass the note content without
    /// frontmatter; markdown syntax is fine (punctuation is not indexed).
    pub body: String,
    /// With or without `#`, any case; stored lowercase.
    pub tags: Vec<String>,
    /// Milliseconds since the epoch.
    pub mtime: f64,
}

/// A search result.
#[derive(Debug, Clone, PartialEq)]
pub struct Hit {
    pub path: String,
    pub title: String,
    /// BM25 relevance; 0 for filter-only queries (which are ordered by
    /// recency instead). Only meaningful relative to other hits.
    pub score: f64,
    /// Up to [`SNIPPET_MAX_CHARS`] of the body around the best match, with
    /// the matched words highlighted; the start of the body if the match
    /// was in the title, headings or a filter.
    pub snippet: Vec<TextPart>,
}

/// The full-text index for one vault.
///
/// Writes (`upsert`, `remove`, `remove_prefix`, `clear`) are staged and
/// become visible to `search` and durable on disk only after
/// [`commit`](Self::commit), so callers should batch them. One writer is
/// held for the index's lifetime (tantivy allows one per directory, across
/// processes), behind a mutex; searches never wait for it.
pub struct SearchIndex {
    index: Index,
    fields: Fields,
    writer: Mutex<IndexWriter>,
    reader: IndexReader,
    needs_rebuild: bool,
    dir: Option<PathBuf>,
}

impl fmt::Debug for SearchIndex {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SearchIndex")
            .field("dir", &self.dir)
            .field("needs_rebuild", &self.needs_rebuild)
            .finish_non_exhaustive()
    }
}

enum OpenFailure {
    /// Another writer holds the lock; the index must not be wiped.
    Locked(IndexError),
    /// Unreadable or incomplete; safe to rebuild.
    Corrupt(IndexError),
}

impl SearchIndex {
    /// Opens the index in `dir`, creating it if needed.
    ///
    /// If the directory holds an index from another [`SCHEMA_VERSION`], a
    /// different schema, or one that can't be read, it is wiped and
    /// recreated empty. [`needs_rebuild`](Self::needs_rebuild) then reports
    /// `true` and the caller should re-index every note. To avoid deleting
    /// the wrong thing, a non-empty directory that doesn't look like a
    /// search index is refused with [`IndexError::NotAnIndex`].
    pub fn open(dir: impl AsRef<Path>) -> Result<Self> {
        let dir = dir.as_ref();
        fs::create_dir_all(dir)?;
        let (schema, fields) = build_schema();

        match read_version(dir) {
            Some(version) if version == SCHEMA_VERSION => {
                match Self::try_open(dir, &schema, fields) {
                    Ok(Some(index)) => return Ok(index),
                    Ok(None) => log::info!(
                        "search index at {} has an outdated schema; rebuilding",
                        dir.display()
                    ),
                    Err(OpenFailure::Locked(err)) => return Err(err),
                    Err(OpenFailure::Corrupt(err)) => log::warn!(
                        "search index at {} is unreadable ({err}); rebuilding",
                        dir.display()
                    ),
                }
            }
            Some(version) => log::info!(
                "search index at {} is schema v{version}, want v{SCHEMA_VERSION}; rebuilding",
                dir.display()
            ),
            None => {}
        }

        reset_dir(dir)?;
        let index = Index::create_in_dir(dir, schema)?;
        fs::write(dir.join(VERSION_FILE), format!("{SCHEMA_VERSION}\n"))?;
        Ok(Self::from_index(
            index,
            fields,
            None,
            true,
            Some(dir.to_path_buf()),
        )?)
    }

    /// A RAM-only index, for tests and benchmarks.
    pub fn in_memory() -> Result<Self> {
        let (schema, fields) = build_schema();
        let index = Index::create_in_ram(schema);
        Ok(Self::from_index(index, fields, Some(1), true, None)?)
    }

    fn try_open(
        dir: &Path,
        schema: &Schema,
        fields: Fields,
    ) -> std::result::Result<Option<Self>, OpenFailure> {
        let index =
            Index::open_in_dir(dir).map_err(|err| OpenFailure::Corrupt(IndexError::from(err)))?;
        if index.schema() != *schema {
            return Ok(None);
        }
        Self::from_index(index, fields, None, false, Some(dir.to_path_buf()))
            .map(Some)
            .map_err(|err| match err {
                TantivyError::LockFailure(..) => OpenFailure::Locked(err.into()),
                err => OpenFailure::Corrupt(err.into()),
            })
    }

    fn from_index(
        index: Index,
        fields: Fields,
        threads: Option<usize>,
        needs_rebuild: bool,
        dir: Option<PathBuf>,
    ) -> tantivy::Result<Self> {
        register_analyzers(&index);
        let writer = match threads {
            Some(threads) => index.writer_with_num_threads(threads, IN_MEMORY_HEAP_BYTES),
            None => index.writer(WRITER_HEAP_BYTES),
        }?;
        let reader = index
            .reader_builder()
            .reload_policy(ReloadPolicy::Manual)
            .try_into()?;
        // Touch every segment so a truncated index fails here, not mid-search.
        let _ = reader.searcher().num_docs();
        Ok(Self {
            index,
            fields,
            writer: Mutex::new(writer),
            reader,
            needs_rebuild,
            dir,
        })
    }

    /// True if the index was created empty by this `open` (first run, schema
    /// change or corruption), so every note must be (re-)indexed.
    pub fn needs_rebuild(&self) -> bool {
        self.needs_rebuild
    }

    /// Number of committed notes.
    pub fn doc_count(&self) -> u64 {
        self.reader.searcher().num_docs()
    }

    fn writer(&self) -> MutexGuard<'_, IndexWriter> {
        // Tantivy's writer keeps no invariants our code could break by
        // panicking, so a poisoned lock is still usable.
        self.writer.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Adds `note`, replacing any document with the same path.
    pub fn upsert(&self, note: &NoteDoc) -> Result<()> {
        let f = &self.fields;
        let mut doc = TantivyDocument::default();
        doc.add_text(f.path, &note.path);
        doc.add_text(f.path_lc, lowercase_path(&note.path));
        doc.add_text(f.title, &note.title);
        for heading in &note.headings {
            doc.add_text(f.headings, heading);
        }
        doc.add_text(f.body, &note.body);
        let mut tags: Vec<String> = note.tags.iter().map(|t| normalize_tag(t)).collect();
        tags.sort();
        tags.dedup();
        for tag in tags.iter().filter(|t| !t.is_empty()) {
            doc.add_text(f.tags, tag);
        }
        doc.add_f64(f.mtime, note.mtime);

        let writer = self.writer();
        writer.delete_term(Term::from_field_text(f.path, &note.path));
        writer.add_document(doc)?;
        Ok(())
    }

    /// Removes the note at `path` (no-op if absent).
    pub fn remove(&self, path: &str) -> Result<()> {
        self.writer()
            .delete_term(Term::from_field_text(self.fields.path, path));
        Ok(())
    }

    /// Removes every note inside `folder` (vault-relative, with or without
    /// a trailing `/`), for folder trash and rename. `Projects` removes
    /// `Projects/a.md` and `Projects/Sub/b.md` but not `Projects 2/c.md`.
    /// An empty folder means the vault root: everything is removed.
    pub fn remove_prefix(&self, folder: &str) -> Result<()> {
        let folder = folder.trim_matches('/');
        if folder.is_empty() {
            return self.clear();
        }
        // '0' is the byte after '/': [folder/, folder0) is exactly "folder/…".
        let field = self.fields.path;
        let query = RangeQuery::new(
            Bound::Included(Term::from_field_text(field, &format!("{folder}/"))),
            Bound::Excluded(Term::from_field_text(field, &format!("{folder}0"))),
        );
        self.writer().delete_query(Box::new(query))?;
        Ok(())
    }

    /// Moves a note to a new path by re-adding it. The index doesn't store
    /// headings and tags, so this needs the (unchanged) note content;
    /// equivalent to `remove(old)` + `upsert(note)`.
    pub fn rename(&self, old_path: &str, note: &NoteDoc) -> Result<()> {
        self.remove(old_path)?;
        self.upsert(note)
    }

    /// Removes every note.
    pub fn clear(&self) -> Result<()> {
        self.writer().delete_query(Box::new(AllQuery))?;
        Ok(())
    }

    /// Makes staged writes durable and visible to `search`.
    pub fn commit(&self) -> Result<()> {
        let mut writer = self.writer();
        writer.commit()?;
        self.reader.reload()?;
        Ok(())
    }

    /// Discards writes staged since the last commit.
    pub fn rollback(&self) -> Result<()> {
        self.writer().rollback()?;
        Ok(())
    }

    /// Runs a query (see [`crate::query`] for the syntax) and returns at
    /// most `limit` hits, best first. Never fails on malformed input: it
    /// matches what it can and returns no hits for the rest. An empty
    /// query returns no hits.
    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<Hit>> {
        let limit = limit.min(MAX_RESULTS);
        if limit == 0 || query.trim().is_empty() {
            return Ok(Vec::new());
        }
        let parsed = query::parse(query, &mut note_analyzer());
        if parsed.is_empty() {
            return Ok(Vec::new());
        }
        let searcher = self.reader.searcher();
        let Some(built) = query::build(&parsed, &self.fields, &searcher)? else {
            return Ok(Vec::new());
        };

        let top: Vec<(f64, DocAddress)> = if built.scored {
            searcher
                .search(&*built.query, &TopDocs::with_limit(limit).order_by_score())?
                .into_iter()
                .map(|(score, address)| (f64::from(score), address))
                .collect()
        } else {
            let by_recency =
                TopDocs::with_limit(limit).order_by_fast_field::<f64>("mtime", Order::Desc);
            searcher
                .search(&*built.query, &by_recency)?
                .into_iter()
                .map(|(_, address)| (0.0, address))
                .collect()
        };

        let snippets = self.snippet_generator(&searcher, &built)?;
        let mut hits = Vec::with_capacity(top.len());
        for (score, address) in top {
            let doc: TantivyDocument = searcher.doc(address)?;
            let text = |field| {
                doc.get_first(field)
                    .and_then(|value| value.as_str())
                    .unwrap_or_default()
                    .to_string()
            };
            let body = text(self.fields.body);
            hits.push(Hit {
                path: text(self.fields.path),
                title: text(self.fields.title),
                score,
                snippet: make_snippet(&snippets, &body),
            });
        }
        Ok(hits)
    }

    fn snippet_generator(
        &self,
        searcher: &Searcher,
        built: &BuiltQuery,
    ) -> Result<SnippetGenerator> {
        let body = self.fields.body;
        let mut terms = BTreeMap::new();
        for text in &built.highlight_terms {
            let doc_freq = searcher.doc_freq(&Term::from_field_text(body, text))?;
            if doc_freq > 0 {
                // Rarer words make better snippets (same weighting tantivy uses).
                terms.insert(text.clone(), 1.0 / (1.0 + doc_freq as f32));
            }
        }
        let tokenizer = self.index.tokenizer_for_field(body)?;
        Ok(SnippetGenerator::new(
            terms,
            tokenizer,
            body,
            SNIPPET_MAX_CHARS,
        ))
    }
}

fn make_snippet(generator: &SnippetGenerator, body: &str) -> Vec<TextPart> {
    let snippet = generator.snippet(body);
    if snippet.highlighted().is_empty() {
        return lead_snippet(body);
    }
    snippet_parts(snippet.fragment(), snippet.highlighted())
}

/// Parts for a tantivy fragment, with surrounding whitespace trimmed.
pub(crate) fn snippet_parts(
    fragment: &str,
    highlighted: &[std::ops::Range<usize>],
) -> Vec<TextPart> {
    let mut parts = parts_from_byte_ranges(fragment, highlighted);
    if let Some(first) = parts.first_mut().filter(|p| !p.highlight) {
        first.text = first.text.trim_start().to_string();
    }
    if let Some(last) = parts.last_mut().filter(|p| !p.highlight) {
        last.text = last.text.trim_end().to_string();
    }
    parts.retain(|p| !p.text.is_empty());
    parts
}

/// The start of the body, cut at a word boundary.
fn lead_snippet(body: &str) -> Vec<TextPart> {
    let body = body.trim_start();
    let end = match body.char_indices().nth(SNIPPET_MAX_CHARS) {
        None => body.len(),
        Some((cut, _)) => match body[..cut].rfind(char::is_whitespace) {
            Some(space) if space > cut / 2 => space,
            _ => cut,
        },
    };
    plain_parts(body[..end].trim_end())
}

fn read_version(dir: &Path) -> Option<u32> {
    fs::read_to_string(dir.join(VERSION_FILE))
        .ok()?
        .trim()
        .parse()
        .ok()
}

/// Deletes the index files in `dir`, refusing if it holds anything that
/// isn't ours (a misconfigured path must never cost the user data).
fn reset_dir(dir: &Path) -> Result<()> {
    let mut files = Vec::new();
    let mut ours = false;
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name();
        if entry.file_type()?.is_dir() {
            return Err(not_an_index(dir));
        }
        ours |= name == VERSION_FILE || name == "meta.json";
        files.push(entry.path());
    }
    if !files.is_empty() && !ours {
        return Err(not_an_index(dir));
    }
    for file in files {
        fs::remove_file(file)?;
    }
    Ok(())
}

fn not_an_index(dir: &Path) -> IndexError {
    IndexError::NotAnIndex {
        path: dir.display().to_string(),
    }
}
