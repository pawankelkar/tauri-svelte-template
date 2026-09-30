//! The search query language and its translation into tantivy queries.
//!
//! The parser is hand-rolled rather than tantivy's `QueryParser` because
//! half the syntax (`#tag`, `path:` prefixes, as-you-type prefixes) has no
//! direct equivalent there, and because it can be *total*: every input
//! string parses to something, so malformed input never reaches the user
//! as an error. Unknown syntax degrades to plain words; input that
//! analyzes to no words (`:::`, `(`, `AND OR`) yields no clauses and
//! therefore no results.
//!
//! Syntax:
//! - `word word` — every word must match (AND); a word matches title
//!   (×3), headings (×2) or body.
//! - `"a phrase"` — words adjacent and in order. An unclosed quote runs to
//!   the end of the input.
//! - `tag:foo`, `#foo` — notes tagged `foo` or a nested `foo/…` tag.
//! - `path:Projects/` — notes whose path starts with the value
//!   (case-insensitive). `path:"My Folder/"` for values with spaces.
//! - `-word`, `-"phrase"`, `-tag:x`, `-path:x`, `NOT word` — exclusion.
//! - `a OR b` — alternatives; `AND` is accepted and ignored.
//! - Parentheses are ignored (no grouping).
//!
//! Prefix matching: when the input does not end in whitespace, the last
//! word is still being typed and matches as a prefix (`ostra` finds
//! `ostralith`). The prefix is expanded against each field's term
//! dictionary into at most [`MAX_EXPANSIONS`] terms (the most frequent
//! ones), OR-ed with the exact term, which scores higher. Expanding
//! ourselves instead of using a `RegexQuery` keeps BM25 scoring and lets
//! the snippet generator highlight the expanded words. A multi-token last
//! word (`foo-ba`, or an unclosed `"hello wor`) uses tantivy's
//! `PhrasePrefixQuery`.

use std::collections::BTreeSet;
use std::ops::Bound;

use tantivy::query::{
    AllQuery, BooleanQuery, BoostQuery, ConstScoreQuery, EnableScoring, Explanation, Occur,
    PhrasePrefixQuery, PhraseQuery, Query, QueryClone, RangeQuery, Scorer, TermQuery, Weight,
};
use tantivy::schema::{Field, IndexRecordOption};
use tantivy::tokenizer::TextAnalyzer;
use tantivy::{DocId, DocSet, Score, Searcher, SegmentReader, Term};

use crate::error::Result;
use crate::schema::{analyze, lowercase_path, normalize_tag, Fields};

/// Upper bound on the terms one as-you-type prefix expands to, per field.
pub(crate) const MAX_EXPANSIONS: usize = 50;
/// Shorter prefixes only match exactly (a lone `a` would expand to noise).
const MIN_PREFIX_CHARS: usize = 2;
/// How many dictionary entries to scan per segment before picking the most
/// frequent [`MAX_EXPANSIONS`].
const EXPANSION_SCAN_LIMIT: usize = 1_000;
/// Score multiplier for expanded (non-exact) prefix terms.
const EXPANSION_BOOST: f32 = 0.8;
const TITLE_BOOST: f32 = 3.0;
const HEADINGS_BOOST: f32 = 2.0;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ClauseKind {
    /// Analyzed words; more than one token is matched as a phrase.
    /// `prefix` makes the last token match as a prefix.
    Text {
        tokens: Vec<String>,
        prefix: bool,
    },
    Tag(String),
    PathPrefix(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Clause {
    pub kind: ClauseKind,
    pub negate: bool,
}

/// Alternatives (`OR`), each a conjunction of clauses.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct ParsedQuery {
    pub groups: Vec<Vec<Clause>>,
}

impl ParsedQuery {
    pub fn is_empty(&self) -> bool {
        self.groups.iter().all(Vec::is_empty)
    }
}

#[derive(Debug)]
struct RawItem {
    negate: bool,
    field: Option<FieldName>,
    text: String,
    quoted: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FieldName {
    Tag,
    Path,
}

fn field_name(name: &str) -> Option<FieldName> {
    match name.to_ascii_lowercase().as_str() {
        "tag" | "tags" => Some(FieldName::Tag),
        "path" | "in" => Some(FieldName::Path),
        _ => None,
    }
}

fn is_separator(c: char) -> bool {
    c.is_whitespace() || c == '(' || c == ')'
}

/// Reads a quoted string starting after the opening quote. Returns the text
/// and the index after the closing quote (or the end).
fn read_quoted(chars: &[char], mut i: usize) -> (String, usize) {
    let start = i;
    while i < chars.len() && chars[i] != '"' {
        i += 1;
    }
    let text = chars[start..i].iter().collect();
    if i < chars.len() {
        i += 1;
    }
    (text, i)
}

fn lex(input: &str) -> Vec<RawItem> {
    let chars: Vec<char> = input.chars().collect();
    let mut items = Vec::new();
    let mut i = 0;
    loop {
        while i < chars.len() && is_separator(chars[i]) {
            i += 1;
        }
        if i >= chars.len() {
            break;
        }
        let mut negate = false;
        if chars[i] == '-' {
            negate = true;
            i += 1;
            if i >= chars.len() || is_separator(chars[i]) {
                continue;
            }
        }
        if chars[i] == '"' {
            let (text, next) = read_quoted(&chars, i + 1);
            i = next;
            items.push(RawItem {
                negate,
                field: None,
                text,
                quoted: true,
            });
            continue;
        }
        let start = i;
        while i < chars.len() && !is_separator(chars[i]) && chars[i] != '"' {
            i += 1;
        }
        let word: String = chars[start..i].iter().collect();
        let (field, value) = match word.split_once(':') {
            Some((name, value)) => match field_name(name) {
                Some(field) => (Some(field), value.to_string()),
                None => (None, word.clone()),
            },
            None => (None, word.clone()),
        };
        if field.is_some() && value.is_empty() && i < chars.len() && chars[i] == '"' {
            let (text, next) = read_quoted(&chars, i + 1);
            i = next;
            items.push(RawItem {
                negate,
                field,
                text,
                quoted: true,
            });
            continue;
        }
        items.push(RawItem {
            negate,
            field,
            text: value,
            quoted: false,
        });
    }
    items
}

/// Parses `input` into clauses. Never fails; see the module docs.
pub(crate) fn parse(input: &str, note_analyzer: &mut TextAnalyzer) -> ParsedQuery {
    let items = lex(input);
    // The last word is still being typed unless the input ends in a
    // separator or a closing quote.
    let still_typing = input
        .chars()
        .last()
        .is_some_and(|c| !is_separator(c) && c != '"');

    let mut groups: Vec<Vec<Clause>> = vec![Vec::new()];
    let mut pending_not = false;
    let last = items.len().saturating_sub(1);
    for (index, item) in items.into_iter().enumerate() {
        if !item.quoted && item.field.is_none() && !item.negate {
            match item.text.as_str() {
                "OR" | "||" => {
                    if groups.last().is_some_and(|g| !g.is_empty()) {
                        groups.push(Vec::new());
                    }
                    continue;
                }
                "AND" | "&&" => continue,
                "NOT" => {
                    pending_not = true;
                    continue;
                }
                _ => {}
            }
        }
        let negate = item.negate || std::mem::take(&mut pending_not);
        let kind = match item.field {
            Some(FieldName::Tag) => ClauseKind::Tag(normalize_tag(&item.text)),
            Some(FieldName::Path) => {
                let value = item.text.trim().trim_start_matches('/');
                ClauseKind::PathPrefix(lowercase_path(value))
            }
            None if !item.quoted && item.text.starts_with('#') => {
                ClauseKind::Tag(normalize_tag(&item.text))
            }
            None => ClauseKind::Text {
                tokens: analyze(note_analyzer, &item.text),
                prefix: index == last && still_typing && !negate,
            },
        };
        let empty = match &kind {
            ClauseKind::Text { tokens, .. } => tokens.is_empty(),
            ClauseKind::Tag(value) | ClauseKind::PathPrefix(value) => value.is_empty(),
        };
        if !empty {
            if let Some(group) = groups.last_mut() {
                group.push(Clause { kind, negate });
            }
        }
    }
    groups.retain(|g| !g.is_empty());
    ParsedQuery { groups }
}

/// A tantivy query ready to run, plus what the snippet generator needs.
pub(crate) struct BuiltQuery {
    pub query: Box<dyn Query>,
    /// False when no clause contributes a relevance score (only filters or
    /// exclusions); results are then ordered by recency instead.
    pub scored: bool,
    /// Body terms to highlight in snippets (positive clauses only).
    pub highlight_terms: BTreeSet<String>,
}

/// Translates a parsed query. Returns `None` if it has no clauses.
pub(crate) fn build(
    parsed: &ParsedQuery,
    fields: &Fields,
    searcher: &Searcher,
) -> Result<Option<BuiltQuery>> {
    let mut highlight_terms = BTreeSet::new();
    let mut scored = false;
    let mut groups: Vec<Box<dyn Query>> = Vec::new();

    for group in &parsed.groups {
        let mut subqueries: Vec<(Occur, Box<dyn Query>)> = Vec::new();
        let mut has_positive = false;
        for clause in group {
            let query = match &clause.kind {
                ClauseKind::Text { tokens, prefix } => {
                    if !clause.negate {
                        scored = true;
                        highlight_terms.extend(tokens.iter().cloned());
                        if *prefix {
                            if let Some(last) = tokens.last() {
                                highlight_terms.extend(expand_prefix(searcher, fields.body, last)?);
                            }
                        }
                    }
                    text_query(tokens, *prefix, fields, searcher)?
                }
                ClauseKind::Tag(tag) => tag_query(fields.tags, tag),
                ClauseKind::PathPrefix(prefix) => path_query(fields.path_lc, prefix),
            };
            if clause.negate {
                let query = Box::new(PlainSeek(query));
                subqueries.push((Occur::MustNot, query));
            } else {
                has_positive = true;
                subqueries.push((Occur::Must, query));
            }
        }
        if subqueries.is_empty() {
            continue;
        }
        if !has_positive {
            subqueries.push((Occur::Must, Box::new(AllQuery)));
        }
        groups.push(Box::new(BooleanQuery::new(subqueries)));
    }

    let query: Box<dyn Query> = match groups.len() {
        0 => return Ok(None),
        1 => groups.remove(0),
        _ => Box::new(BooleanQuery::union(groups)),
    };
    Ok(Some(BuiltQuery {
        query,
        scored,
        highlight_terms,
    }))
}

fn term_query(field: Field, text: &str) -> Box<dyn Query> {
    Box::new(TermQuery::new(
        Term::from_field_text(field, text),
        IndexRecordOption::WithFreqs,
    ))
}

fn boosted(query: Box<dyn Query>, boost: f32) -> Box<dyn Query> {
    if (boost - 1.0).abs() < f32::EPSILON {
        query
    } else {
        Box::new(BoostQuery::new(query, boost))
    }
}

/// One text clause across title, headings and body.
fn text_query(
    tokens: &[String],
    prefix: bool,
    fields: &Fields,
    searcher: &Searcher,
) -> Result<Box<dyn Query>> {
    let mut per_field = Vec::with_capacity(3);
    for (field, boost) in [
        (fields.title, TITLE_BOOST),
        (fields.headings, HEADINGS_BOOST),
        (fields.body, 1.0),
    ] {
        let query = field_text_query(field, tokens, prefix, searcher)?;
        per_field.push(boosted(query, boost));
    }
    Ok(Box::new(BooleanQuery::union(per_field)))
}

fn field_text_query(
    field: Field,
    tokens: &[String],
    prefix: bool,
    searcher: &Searcher,
) -> Result<Box<dyn Query>> {
    let terms = || {
        tokens
            .iter()
            .map(|t| Term::from_field_text(field, t))
            .collect::<Vec<_>>()
    };
    Ok(match tokens {
        [token] if prefix => {
            let expansions = expand_prefix(searcher, field, token)?;
            let mut clauses: Vec<(Occur, Box<dyn Query>)> =
                vec![(Occur::Should, term_query(field, token))];
            for expansion in expansions.iter().filter(|e| *e != token) {
                clauses.push((
                    Occur::Should,
                    boosted(term_query(field, expansion), EXPANSION_BOOST),
                ));
            }
            if clauses.len() == 1 {
                clauses.remove(0).1
            } else {
                Box::new(BooleanQuery::new(clauses))
            }
        }
        [token] => term_query(field, token),
        _ if prefix => {
            let mut query = PhrasePrefixQuery::new(terms());
            query.set_max_expansions(MAX_EXPANSIONS as u32);
            Box::new(query)
        }
        _ => Box::new(PhraseQuery::new(terms())),
    })
}

/// Terms in `field` starting with `prefix`: the most frequent
/// [`MAX_EXPANSIONS`] of them. Empty for prefixes that are too short.
pub(crate) fn expand_prefix(
    searcher: &Searcher,
    field: Field,
    prefix: &str,
) -> Result<Vec<String>> {
    if prefix.chars().count() < MIN_PREFIX_CHARS {
        return Ok(Vec::new());
    }
    let mut found = BTreeSet::new();
    for segment in searcher.segment_readers() {
        let inverted = segment.inverted_index(field)?;
        let mut stream = inverted
            .terms()
            .range()
            .ge(prefix.as_bytes())
            .into_stream()?;
        let mut scanned = 0;
        while stream.advance() && scanned < EXPANSION_SCAN_LIMIT {
            let key = stream.key();
            if !key.starts_with(prefix.as_bytes()) {
                break;
            }
            if let Ok(term) = std::str::from_utf8(key) {
                found.insert(term.to_string());
            }
            scanned += 1;
        }
    }
    let mut found: Vec<String> = found.into_iter().collect();
    if found.len() > MAX_EXPANSIONS {
        let mut with_freq = Vec::with_capacity(found.len());
        for term in found {
            let freq = searcher.doc_freq(&Term::from_field_text(field, &term))?;
            with_freq.push((freq, term));
        }
        with_freq.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
        found = with_freq
            .into_iter()
            .take(MAX_EXPANSIONS)
            .map(|(_, term)| term)
            .collect();
    }
    Ok(found)
}

/// `tag:foo` matches `foo` and nested tags `foo/…`. Unscored.
fn tag_query(field: Field, tag: &str) -> Box<dyn Query> {
    // '0' is the byte right after '/', so [tag/, tag0) is exactly "tag/…".
    let nested = RangeQuery::new(
        Bound::Included(Term::from_field_text(field, &format!("{tag}/"))),
        Bound::Excluded(Term::from_field_text(field, &format!("{tag}0"))),
    );
    let query = BooleanQuery::union(vec![term_query(field, tag), Box::new(nested)]);
    Box::new(ConstScoreQuery::new(Box::new(query), 0.0))
}

/// Paths starting with `prefix`. Unscored.
pub(crate) fn path_query(field: Field, prefix: &str) -> Box<dyn Query> {
    let query = RangeQuery::new(
        Bound::Included(Term::from_field_text(field, prefix)),
        Bound::Excluded(Term::from_field_text(field, &prefix_upper_bound(prefix))),
    );
    Box::new(ConstScoreQuery::new(Box::new(query), 0.0))
}

/// A string greater than every string starting with `prefix` (except ones
/// continuing with U+10FFFF, which don't occur in paths).
fn prefix_upper_bound(prefix: &str) -> String {
    let mut upper = prefix.to_string();
    upper.push(char::MAX);
    upper
}

/// Wraps a query so its scorer only exposes `advance`/`seek`, hiding the
/// inner scorer's `seek_danger`.
///
/// Tantivy 0.26's phrase scorers assume `seek_danger` targets are never
/// behind their current doc, but an exclusion set (`MustNot`) calls it with
/// targets from the included docs, which can be behind. That trips a debug
/// assertion (and could skip docs in release). Excluded clauses go through
/// this wrapper, so exclusion falls back to the always-correct default
/// `seek_danger` built on `seek`.
#[derive(Debug)]
struct PlainSeek(Box<dyn Query>);

impl Clone for PlainSeek {
    fn clone(&self) -> Self {
        PlainSeek(self.0.box_clone())
    }
}

impl Query for PlainSeek {
    fn weight(&self, enable_scoring: EnableScoring<'_>) -> tantivy::Result<Box<dyn Weight>> {
        Ok(Box::new(PlainSeekWeight(self.0.weight(enable_scoring)?)))
    }

    fn query_terms<'a>(&'a self, visitor: &mut dyn FnMut(&'a Term, bool)) {
        self.0.query_terms(visitor);
    }
}

struct PlainSeekWeight(Box<dyn Weight>);

impl Weight for PlainSeekWeight {
    fn scorer(&self, reader: &SegmentReader, boost: Score) -> tantivy::Result<Box<dyn Scorer>> {
        Ok(Box::new(PlainSeekScorer(self.0.scorer(reader, boost)?)))
    }

    fn explain(&self, reader: &SegmentReader, doc: DocId) -> tantivy::Result<Explanation> {
        self.0.explain(reader, doc)
    }
}

struct PlainSeekScorer(Box<dyn Scorer>);

impl DocSet for PlainSeekScorer {
    fn advance(&mut self) -> DocId {
        self.0.advance()
    }

    fn seek(&mut self, target: DocId) -> DocId {
        self.0.seek(target)
    }

    fn doc(&self) -> DocId {
        self.0.doc()
    }

    fn size_hint(&self) -> u32 {
        self.0.size_hint()
    }

    fn cost(&self) -> u64 {
        self.0.cost()
    }
}

impl Scorer for PlainSeekScorer {
    fn score(&mut self) -> Score {
        self.0.score()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::note_analyzer;

    fn p(input: &str) -> ParsedQuery {
        parse(input, &mut note_analyzer())
    }

    fn text(tokens: &[&str], prefix: bool) -> ClauseKind {
        ClauseKind::Text {
            tokens: tokens.iter().map(|t| t.to_string()).collect(),
            prefix,
        }
    }

    fn pos(kind: ClauseKind) -> Clause {
        Clause {
            kind,
            negate: false,
        }
    }

    fn neg(kind: ClauseKind) -> Clause {
        Clause { kind, negate: true }
    }

    #[test]
    fn words_and_prefix() {
        assert_eq!(
            p("Hello wor").groups,
            vec![vec![
                pos(text(&["hello"], false)),
                pos(text(&["wor"], true))
            ]]
        );
        assert_eq!(
            p("hello world ").groups,
            vec![vec![
                pos(text(&["hello"], false)),
                pos(text(&["world"], false))
            ]]
        );
    }

    #[test]
    fn phrases_filters_and_exclusions() {
        assert_eq!(
            p(r#""big idea" tag:Rust #Todo/Now path:Projects/ -draft -"old stuff""#).groups,
            vec![vec![
                pos(text(&["big", "idea"], false)),
                pos(ClauseKind::Tag("rust".into())),
                pos(ClauseKind::Tag("todo/now".into())),
                pos(ClauseKind::PathPrefix("projects/".into())),
                neg(text(&["draft"], false)),
                neg(text(&["old", "stuff"], false)),
            ]]
        );
    }

    #[test]
    fn quoted_field_values() {
        assert_eq!(
            p(r#"path:"My Folder/Sub" tag:"a b""#).groups,
            vec![vec![
                pos(ClauseKind::PathPrefix("my folder/sub".into())),
                pos(ClauseKind::Tag("a b".into())),
            ]]
        );
    }

    #[test]
    fn unclosed_quote_is_a_phrase_prefix() {
        assert_eq!(
            p(r#"x "hello wor"#).groups,
            vec![vec![
                pos(text(&["x"], false)),
                pos(text(&["hello", "wor"], true))
            ]]
        );
    }

    #[test]
    fn boolean_words() {
        assert_eq!(
            p("a OR b AND c NOT d").groups,
            vec![
                vec![pos(text(&["a"], false))],
                vec![
                    pos(text(&["b"], false)),
                    pos(text(&["c"], false)),
                    neg(text(&["d"], false)),
                ],
            ]
        );
    }

    #[test]
    fn garbage_parses_to_nothing_or_words() {
        for input in [
            "",
            "   ",
            "(",
            ")",
            ":::",
            "AND OR",
            "OR",
            "-",
            "--",
            "\"",
            "\"\"",
            "#",
            "tag:",
            "path:",
            "()",
            "NOT",
            "- - -",
            "\"unclosed",
        ] {
            let parsed = p(input);
            if input == "\"unclosed" {
                assert_eq!(parsed.groups, vec![vec![pos(text(&["unclosed"], true))]]);
            } else {
                assert!(parsed.is_empty(), "{input:?} gave {parsed:?}");
            }
        }
        assert_eq!(
            p("foo:bar").groups,
            vec![vec![pos(text(&["foo", "bar"], true))]]
        );
    }
}
