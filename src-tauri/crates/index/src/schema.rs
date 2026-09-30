//! The tantivy schema and the text analyzers it uses.
//!
//! # Analyzer choice
//!
//! Notes are mostly English but regularly contain other languages, so the
//! `ostralith` analyzer is language-neutral:
//!
//! 1. [`NoteTokenizer`] splits on anything that isn't a letter or digit
//!    (like tantivy's `SimpleTokenizer`), with two Unicode refinements:
//!    Han ideographs and Japanese kana become one token per char (those
//!    scripts don't put spaces between words, so a run of them would
//!    otherwise be one giant unsearchable token; multi-char queries then
//!    run as phrase queries), and combining diacritics (U+0300 block etc.)
//!    stay inside the word but are dropped from the token text, so
//!    decomposed `cafe\u{301}` indexes as `cafe`.
//! 2. `RemoveLongFilter` drops tokens of 100+ bytes (base64 blobs, hashes).
//! 3. `LowerCaser`, then `AsciiFoldingFilter` (`café` → `cafe`, `Straße` →
//!    `strasse`), so accents never have to be typed.
//!
//! There is deliberately **no stemming**: as-you-type prefix matching
//! expands the last query word against the indexed terms, and stemmed terms
//! (`running` → `run`) would make a half-typed `runn` stop matching. Stems
//! would also be wrong for every non-English note. Prefix matching covers
//! the common plural/inflection case while typing (`note` finds `notes`).
//! Adding `Stemmer` here requires bumping [`SCHEMA_VERSION`].

use std::iter::Peekable;
use std::str::CharIndices;

use tantivy::schema::{
    Field, IndexRecordOption, Schema, TextFieldIndexing, TextOptions, FAST, STORED, STRING,
};
use tantivy::tokenizer::{
    AsciiFoldingFilter, LowerCaser, RemoveLongFilter, TextAnalyzer, Token, TokenStream, Tokenizer,
};
use tantivy::Index;

use crate::text::is_combining_mark;

/// Bump whenever the schema or an analyzer changes: an index written with a
/// different version is wiped and rebuilt on open.
pub(crate) const SCHEMA_VERSION: u32 = 1;

/// Analyzer for title, headings and body.
pub(crate) const NOTE_ANALYZER: &str = "ostralith";

const MAX_TOKEN_BYTES: usize = 100;

#[derive(Debug, Clone, Copy)]
pub(crate) struct Fields {
    /// Vault-relative path, exact. The document key.
    pub path: Field,
    /// Lowercased path (see [`lowercase_path`]), for case-insensitive
    /// `path:` prefix filters. A fast field, so a prefix is one ordinal
    /// range scan instead of a union over every matching path term.
    pub path_lc: Field,
    pub title: Field,
    pub headings: Field,
    pub body: Field,
    /// Lowercased tags without `#`, one term per tag.
    pub tags: Field,
    pub mtime: Field,
}

pub(crate) fn build_schema() -> (Schema, Fields) {
    let mut builder = Schema::builder();
    let text = TextFieldIndexing::default()
        .set_tokenizer(NOTE_ANALYZER)
        .set_index_option(IndexRecordOption::WithFreqsAndPositions);

    let fields = Fields {
        path: builder.add_text_field("path", STRING | STORED),
        path_lc: builder.add_text_field("path_lc", STRING | FAST),
        title: builder.add_text_field(
            "title",
            TextOptions::default()
                .set_indexing_options(text.clone())
                .set_stored(),
        ),
        headings: builder.add_text_field(
            "headings",
            TextOptions::default().set_indexing_options(text.clone()),
        ),
        body: builder.add_text_field(
            "body",
            TextOptions::default()
                .set_indexing_options(text)
                .set_stored(),
        ),
        tags: builder.add_text_field("tags", STRING),
        mtime: builder.add_f64_field("mtime", FAST),
    };
    (builder.build(), fields)
}

pub(crate) fn note_analyzer() -> TextAnalyzer {
    TextAnalyzer::builder(NoteTokenizer::default())
        .filter(RemoveLongFilter::limit(MAX_TOKEN_BYTES))
        .filter(LowerCaser)
        .filter(AsciiFoldingFilter)
        .build()
}

/// The `path_lc` form of a path or `path:` value. Applied on both sides
/// so index and query always agree.
pub(crate) fn lowercase_path(path: &str) -> String {
    path.chars().flat_map(char::to_lowercase).collect()
}

pub(crate) fn register_analyzers(index: &Index) {
    index.tokenizers().register(NOTE_ANALYZER, note_analyzer());
}

/// Runs `text` through `analyzer` and returns the token texts.
pub(crate) fn analyze(analyzer: &mut TextAnalyzer, text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut stream = analyzer.token_stream(text);
    while stream.advance() {
        tokens.push(stream.token().text.clone());
    }
    tokens
}

/// Lowercases a tag and strips the `#` and any trailing `/`.
pub(crate) fn normalize_tag(tag: &str) -> String {
    tag.trim()
        .trim_start_matches('#')
        .trim_end_matches('/')
        .to_lowercase()
}

/// Word splitter for notes; see the module docs.
#[derive(Clone, Default)]
pub(crate) struct NoteTokenizer {
    token: Token,
}

pub(crate) struct NoteTokenStream<'a> {
    chars: Peekable<CharIndices<'a>>,
    token: &'a mut Token,
}

impl Tokenizer for NoteTokenizer {
    type TokenStream<'a> = NoteTokenStream<'a>;

    fn token_stream<'a>(&'a mut self, text: &'a str) -> NoteTokenStream<'a> {
        self.token.reset();
        NoteTokenStream {
            chars: text.char_indices().peekable(),
            token: &mut self.token,
        }
    }
}

impl TokenStream for NoteTokenStream<'_> {
    fn advance(&mut self) -> bool {
        self.token.text.clear();
        self.token.position = self.token.position.wrapping_add(1);
        while let Some((start, c)) = self.chars.next() {
            if is_unigram_char(c) {
                self.token.offset_from = start;
                self.token.offset_to = start + c.len_utf8();
                self.token.text.push(c);
                return true;
            }
            if !c.is_alphanumeric() {
                continue;
            }
            self.token.text.push(c);
            let mut end = start + c.len_utf8();
            while let Some(&(offset, next)) = self.chars.peek() {
                if is_unigram_char(next) {
                    break;
                }
                if next.is_alphanumeric() {
                    self.token.text.push(next);
                } else if !is_combining_mark(next) {
                    break;
                }
                end = offset + next.len_utf8();
                self.chars.next();
            }
            self.token.offset_from = start;
            self.token.offset_to = end;
            return true;
        }
        false
    }

    fn token(&self) -> &Token {
        self.token
    }

    fn token_mut(&mut self) -> &mut Token {
        self.token
    }
}

/// Scripts written without spaces between words: Han ideographs, kana.
fn is_unigram_char(c: char) -> bool {
    matches!(c,
        '\u{3040}'..='\u{30FF}'   // Hiragana, Katakana
        | '\u{31F0}'..='\u{31FF}' // Katakana phonetic extensions
        | '\u{3400}'..='\u{4DBF}' // CJK extension A
        | '\u{4E00}'..='\u{9FFF}' // CJK unified ideographs
        | '\u{F900}'..='\u{FAFF}' // CJK compatibility ideographs
        | '\u{FF66}'..='\u{FF9F}' // Halfwidth katakana
        | '\u{20000}'..='\u{3134F}' // CJK extensions B–G
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tokens(text: &str) -> Vec<String> {
        analyze(&mut note_analyzer(), text)
    }

    #[test]
    fn folds_case_and_accents() {
        assert_eq!(tokens("Café CRÈME Straße"), ["cafe", "creme", "strasse"]);
        assert_eq!(tokens("cafe\u{301} au lait"), ["cafe", "au", "lait"]);
    }

    #[test]
    fn splits_on_punctuation() {
        assert_eq!(
            tokens("ostralith://notes/Foo-bar, baz_1!"),
            ["ostralith", "notes", "foo", "bar", "baz", "1"]
        );
    }

    #[test]
    fn cjk_is_one_token_per_char() {
        assert_eq!(
            tokens("Ostralith日本語です"),
            ["ostralith", "日", "本", "語", "で", "す"]
        );
        // Hangul uses spaces between words, so it stays word-based.
        assert_eq!(tokens("안녕하세요 세계"), ["안녕하세요", "세계"]);
    }

    #[test]
    fn offsets_cover_the_original_text() {
        let text = "  Crème brûlée";
        let mut analyzer = note_analyzer();
        let mut stream = analyzer.token_stream(text);
        let mut spans = Vec::new();
        while stream.advance() {
            let t = stream.token();
            spans.push(&text[t.offset_from..t.offset_to]);
        }
        assert_eq!(spans, ["Crème", "brûlée"]);
    }

    #[test]
    fn drops_huge_tokens() {
        let blob = "a".repeat(200);
        assert_eq!(tokens(&format!("x {blob} y")), ["x", "y"]);
    }

    #[test]
    fn tags_normalize() {
        assert_eq!(normalize_tag("#Project/Alpha/"), "project/alpha");
        assert_eq!(normalize_tag(" Rust "), "rust");
    }
}
