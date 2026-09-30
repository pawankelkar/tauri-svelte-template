//! Fuzzy ranking for the quick-open palette.
//!
//! Matching uses `nucleo-matcher` (the fzf-style matcher from the Helix
//! editor): every query word must appear in order as a subsequence, with
//! bonuses for consecutive chars, word/camelCase/path-segment boundaries
//! and a match at the start. Case is smart (an uppercase letter in the
//! query makes matching case-sensitive) and Latin diacritics are
//! normalized (`cafe` matches `Café`).
//!
//! Ranking, best first:
//! 1. candidates whose **title** matches, ahead of ones matching only by
//!    path;
//! 2. higher match score;
//! 3. more recently modified;
//! 4. shorter path, then path order (so the output is deterministic).
//!
//! Match positions are char (Unicode scalar) indices, converted into
//! [`TextPart`]s over chars, so a multi-byte char is never split.

use std::cmp::Ordering;

use nucleo_matcher::pattern::{AtomKind, CaseMatching, Normalization, Pattern};
use nucleo_matcher::{Config, Matcher, Utf32Str};

use crate::text::{parts_from_char_indices, plain_parts, TextPart};

/// A note that quick-open can offer.
#[derive(Debug, Clone, PartialEq)]
pub struct QuickOpenCandidate {
    /// Vault-relative path.
    pub path: String,
    pub title: String,
    /// Milliseconds since the epoch.
    pub mtime: f64,
}

/// A ranked candidate with highlighted title and path.
#[derive(Debug, Clone, PartialEq)]
pub struct QuickOpenMatch {
    pub path: String,
    pub title: String,
    /// Matcher score of the title (or of the path, for path-only matches);
    /// 0 for an empty query. The result order is authoritative: a title
    /// match outranks a path match whatever the scores.
    pub score: f64,
    pub title_parts: Vec<TextPart>,
    pub path_parts: Vec<TextPart>,
}

#[derive(Clone, Copy)]
struct Scored {
    title_match: bool,
    score: u32,
    index: usize,
}

/// Ranks `items` against `query` and returns the best `limit`.
///
/// An empty (or whitespace) query returns the `limit` most recently
/// modified items, without highlights.
pub fn rank(query: &str, items: &[QuickOpenCandidate], limit: usize) -> Vec<QuickOpenMatch> {
    if limit == 0 || items.is_empty() {
        return Vec::new();
    }
    let query = query.trim();
    if query.is_empty() {
        return most_recent(items, limit);
    }

    let pattern = Pattern::new(
        query,
        CaseMatching::Smart,
        Normalization::Smart,
        AtomKind::Fuzzy,
    );
    let mut title_config = Config::DEFAULT;
    title_config.prefer_prefix = true;
    let mut title_matcher = Matcher::new(title_config);
    let mut path_matcher = Matcher::new(Config::DEFAULT.match_paths());
    let mut buf = Vec::new();

    let mut scored: Vec<Scored> = Vec::new();
    for (index, item) in items.iter().enumerate() {
        if let Some(score) = pattern.score(utf32(&item.title, &mut buf), &mut title_matcher) {
            scored.push(Scored {
                title_match: true,
                score,
                index,
            });
        } else if let Some(score) = pattern.score(utf32(&item.path, &mut buf), &mut path_matcher) {
            scored.push(Scored {
                title_match: false,
                score,
                index,
            });
        }
    }

    let compare = |a: &Scored, b: &Scored| {
        b.title_match
            .cmp(&a.title_match)
            .then_with(|| b.score.cmp(&a.score))
            .then_with(|| compare_recency(&items[a.index], &items[b.index]))
    };
    if scored.len() > limit {
        scored.select_nth_unstable_by(limit - 1, compare);
        scored.truncate(limit);
    }
    scored.sort_unstable_by(compare);

    let mut indices = Vec::new();
    scored
        .into_iter()
        .map(|s| {
            let item = &items[s.index];
            let title_parts = highlight(
                &pattern,
                &mut title_matcher,
                &item.title,
                &mut buf,
                &mut indices,
            );
            let path_parts = highlight(
                &pattern,
                &mut path_matcher,
                &item.path,
                &mut buf,
                &mut indices,
            );
            QuickOpenMatch {
                path: item.path.clone(),
                title: item.title.clone(),
                score: f64::from(s.score),
                title_parts,
                path_parts,
            }
        })
        .collect()
}

fn most_recent(items: &[QuickOpenCandidate], limit: usize) -> Vec<QuickOpenMatch> {
    let mut order: Vec<&QuickOpenCandidate> = items.iter().collect();
    if order.len() > limit {
        order.select_nth_unstable_by(limit - 1, |a, b| compare_recency(a, b));
        order.truncate(limit);
    }
    order.sort_unstable_by(|a, b| compare_recency(a, b));
    order
        .into_iter()
        .map(|item| QuickOpenMatch {
            path: item.path.clone(),
            title: item.title.clone(),
            score: 0.0,
            title_parts: plain_parts(&item.title),
            path_parts: plain_parts(&item.path),
        })
        .collect()
}

/// Newest first, then shorter path, then path order.
fn compare_recency(a: &QuickOpenCandidate, b: &QuickOpenCandidate) -> Ordering {
    b.mtime
        .total_cmp(&a.mtime)
        .then_with(|| a.path.len().cmp(&b.path.len()))
        .then_with(|| a.path.cmp(&b.path))
}

/// Parts for `text`, highlighting where `pattern` matches (plain if it
/// doesn't match on its own).
fn highlight(
    pattern: &Pattern,
    matcher: &mut Matcher,
    text: &str,
    buf: &mut Vec<char>,
    indices: &mut Vec<u32>,
) -> Vec<TextPart> {
    indices.clear();
    if pattern
        .indices(utf32(text, buf), matcher, indices)
        .is_none()
    {
        indices.clear();
    }
    parts_from_char_indices(text, indices)
}

/// Builds the matcher's view of `text` with one element per char.
///
/// `Utf32Str::new` would segment by grapheme cluster when nucleo's
/// `unicode-segmentation` feature is on (which another crate in the
/// workspace could enable), making indices grapheme-based. Building it
/// ourselves keeps indices char-based regardless of features.
fn utf32<'a>(text: &'a str, buf: &'a mut Vec<char>) -> Utf32Str<'a> {
    if text.is_ascii() {
        Utf32Str::Ascii(text.as_bytes())
    } else {
        buf.clear();
        buf.extend(text.chars());
        Utf32Str::Unicode(buf)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::text::join_parts;

    fn item(path: &str, title: &str, mtime: f64) -> QuickOpenCandidate {
        QuickOpenCandidate {
            path: path.into(),
            title: title.into(),
            mtime,
        }
    }

    fn paths(matches: &[QuickOpenMatch]) -> Vec<&str> {
        matches.iter().map(|m| m.path.as_str()).collect()
    }

    fn highlighted(parts: &[TextPart]) -> String {
        parts
            .iter()
            .filter(|p| p.highlight)
            .map(|p| p.text.as_str())
            .collect()
    }

    #[test]
    fn title_match_beats_path_only_match() {
        let items = [
            item("Ostralith/random.md", "Random", 10.0),
            item("Notes/Ostralith plan.md", "Ostralith plan", 1.0),
        ];
        let ranked = rank("ostra", &items, 10);
        assert_eq!(
            paths(&ranked),
            ["Notes/Ostralith plan.md", "Ostralith/random.md"]
        );
        assert_eq!(highlighted(&ranked[0].title_parts), "Ostra");
        // Path-only match: the title is shown plain, the path highlighted.
        assert_eq!(highlighted(&ranked[1].title_parts), "");
        assert_eq!(highlighted(&ranked[1].path_parts), "Ostra");
    }

    #[test]
    fn contiguous_beats_scattered() {
        let items = [
            item("a.md", "Pro jam echo cat tea", 5.0),
            item("b.md", "Project", 1.0),
        ];
        let ranked = rank("proj", &items, 10);
        assert_eq!(paths(&ranked), ["b.md", "a.md"]);
    }

    #[test]
    fn recency_breaks_ties_then_shorter_path() {
        let items = [
            item("old/Meeting.md", "Meeting", 1.0),
            item("new/Meeting.md", "Meeting", 3.0),
            item("x/Meeting.md", "Meeting", 2.0),
            item("longer/Meeting.md", "Meeting", 2.0),
        ];
        let ranked = rank("meeting", &items, 10);
        assert_eq!(
            paths(&ranked),
            [
                "new/Meeting.md",
                "x/Meeting.md",
                "longer/Meeting.md",
                "old/Meeting.md"
            ]
        );
    }

    #[test]
    fn no_match_is_excluded() {
        let items = [item("a.md", "Alpha", 1.0), item("b.md", "Beta", 2.0)];
        assert_eq!(paths(&rank("zzz", &items, 10)), Vec::<&str>::new());
        assert_eq!(paths(&rank("bta", &items, 10)), ["b.md"]);
    }

    #[test]
    fn unicode_titles() {
        let items = [
            item("Café 日本語.md", "Café 日本語", 1.0),
            item("other.md", "Other", 2.0),
        ];
        let ranked = rank("cafe 日本", &items, 10);
        assert_eq!(paths(&ranked), ["Café 日本語.md"]);
        let parts = &ranked[0].title_parts;
        assert_eq!(join_parts(parts), "Café 日本語");
        assert_eq!(highlighted(parts), "Café日本");
        assert_eq!(join_parts(&ranked[0].path_parts), "Café 日本語.md");

        let ranked = rank("語", &items, 10);
        assert_eq!(highlighted(&ranked[0].title_parts), "語");
    }

    #[test]
    fn smart_case() {
        let items = [item("a.md", "readme", 2.0), item("b.md", "README", 1.0)];
        assert_eq!(rank("readme", &items, 10).len(), 2);
        assert_eq!(paths(&rank("READ", &items, 10)), ["b.md"]);
    }

    #[test]
    fn empty_query_is_most_recent() {
        let items = [
            item("a.md", "A", 1.0),
            item("b.md", "B", 3.0),
            item("c.md", "C", 2.0),
        ];
        let ranked = rank("  ", &items, 2);
        assert_eq!(paths(&ranked), ["b.md", "c.md"]);
        assert!(ranked
            .iter()
            .all(|m| m.score == 0.0 && highlighted(&m.title_parts).is_empty()));
        assert_eq!(ranked[0].title_parts, vec![TextPart::plain("B")]);
    }

    #[test]
    fn limit_is_respected() {
        let items: Vec<_> = (0..100)
            .map(|i| item(&format!("n/{i}.md"), &format!("Note {i}"), f64::from(i)))
            .collect();
        let ranked = rank("note", &items, 5);
        assert_eq!(
            paths(&ranked),
            ["n/99.md", "n/98.md", "n/97.md", "n/96.md", "n/95.md"]
        );
        assert!(rank("note", &items, 0).is_empty());
        assert!(rank("note", &[], 5).is_empty());
    }

    #[test]
    fn fifty_thousand_candidates_rank_quickly() {
        let items: Vec<_> = (0..50_000)
            .map(|i| {
                item(
                    &format!("Area {}/Project {}/Note {i}.md", i % 17, i % 101),
                    &format!("Note {i} about topic {}", i % 313),
                    f64::from(i),
                )
            })
            .collect();
        let start = std::time::Instant::now();
        let ranked = rank("prj nt 42", &items, 50);
        let elapsed = start.elapsed();
        assert!(!ranked.is_empty());
        // Generous bound so unoptimized test builds pass; release is far faster.
        assert!(elapsed.as_millis() < 2_000, "took {elapsed:?}");
    }
}
