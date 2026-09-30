//! [`TextPart`] segments: highlighted text that never splits a UTF-8 char.
//!
//! Search snippets and quick-open matches are returned as a list of parts
//! instead of offsets, so the UI never has to translate between Rust byte
//! offsets and JavaScript UTF-16 indices.

use std::ops::Range;

/// A run of text that is either highlighted (matched) or plain.
///
/// Concatenating the `text` of every part gives back the original string.
/// Consecutive parts always differ in `highlight`, and no part is empty.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextPart {
    pub text: String,
    pub highlight: bool,
}

impl TextPart {
    pub fn plain(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            highlight: false,
        }
    }

    pub fn highlighted(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            highlight: true,
        }
    }
}

/// Joins the parts back into one string.
pub fn join_parts(parts: &[TextPart]) -> String {
    parts.iter().map(|part| part.text.as_str()).collect()
}

/// A single plain part for `text`, or nothing if `text` is empty.
pub(crate) fn plain_parts(text: &str) -> Vec<TextPart> {
    if text.is_empty() {
        Vec::new()
    } else {
        vec![TextPart::plain(text)]
    }
}

/// Appends `text` to `parts`, merging with the last part when the highlight
/// state matches so the output stays minimal.
fn push_part(parts: &mut Vec<TextPart>, text: &str, highlight: bool) {
    if text.is_empty() {
        return;
    }
    match parts.last_mut() {
        Some(last) if last.highlight == highlight => last.text.push_str(text),
        _ => parts.push(TextPart {
            text: text.to_string(),
            highlight,
        }),
    }
}

/// Splits `text` into parts, highlighting the given byte ranges.
///
/// Ranges may overlap or be unsorted. A range that is out of bounds or does
/// not sit on char boundaries is ignored rather than risking a split char.
pub(crate) fn parts_from_byte_ranges(text: &str, ranges: &[Range<usize>]) -> Vec<TextPart> {
    let mut valid: Vec<Range<usize>> = ranges
        .iter()
        .filter(|r| {
            r.start < r.end
                && r.end <= text.len()
                && text.is_char_boundary(r.start)
                && text.is_char_boundary(r.end)
        })
        .cloned()
        .collect();
    valid.sort_by_key(|r| (r.start, r.end));

    let mut parts = Vec::new();
    let mut cursor = 0;
    for range in valid {
        let start = range.start.max(cursor);
        if start >= range.end {
            continue;
        }
        push_part(&mut parts, &text[cursor..start], false);
        push_part(&mut parts, &text[start..range.end], true);
        cursor = range.end;
    }
    push_part(&mut parts, &text[cursor..], false);
    parts
}

/// Splits `text` into parts, highlighting the chars (Unicode scalar values,
/// not bytes) at the given indices. Indices may be unsorted or repeated.
///
/// A combining mark takes the highlight state of the char before it, so an
/// accent is never visually separated from its base letter.
pub(crate) fn parts_from_char_indices(text: &str, indices: &[u32]) -> Vec<TextPart> {
    if indices.is_empty() {
        return plain_parts(text);
    }
    let mut sorted = indices.to_vec();
    sorted.sort_unstable();
    sorted.dedup();

    let mut parts: Vec<TextPart> = Vec::new();
    let mut next = sorted.iter().peekable();
    let mut run_start = 0;
    let mut run_highlight = false;
    let mut previous_highlight = false;
    for (char_index, (byte_index, c)) in text.char_indices().enumerate() {
        let char_index = char_index as u32;
        while next.next_if(|&&i| i < char_index).is_some() {}
        let mut highlight = next.next_if(|&&i| i == char_index).is_some();
        if char_index > 0 && is_combining_mark(c) {
            highlight = previous_highlight;
        }
        if highlight != run_highlight {
            push_part(&mut parts, &text[run_start..byte_index], run_highlight);
            run_start = byte_index;
            run_highlight = highlight;
        }
        previous_highlight = highlight;
    }
    push_part(&mut parts, &text[run_start..], run_highlight);
    parts
}

/// Combining diacritical marks and joiners: chars that render on top of (or
/// glue onto) the previous char and carry no meaning on their own.
pub(crate) fn is_combining_mark(c: char) -> bool {
    matches!(c,
        '\u{0300}'..='\u{036F}'
        | '\u{1AB0}'..='\u{1AFF}'
        | '\u{1DC0}'..='\u{1DFF}'
        | '\u{20D0}'..='\u{20FF}'
        | '\u{FE00}'..='\u{FE0F}'
        | '\u{FE20}'..='\u{FE2F}'
        | '\u{200C}' | '\u{200D}'
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn byte_ranges_reassemble() {
        let text = "hello wide world";
        let parts = parts_from_byte_ranges(text, &[6..10, 0..5]);
        assert_eq!(join_parts(&parts), text);
        assert_eq!(
            parts,
            vec![
                TextPart::highlighted("hello"),
                TextPart::plain(" "),
                TextPart::highlighted("wide"),
                TextPart::plain(" world"),
            ]
        );
    }

    #[test]
    fn overlapping_and_invalid_byte_ranges() {
        let text = "café au lait";
        // 3..4 would split the two-byte "é"; it must be ignored.
        let parts = parts_from_byte_ranges(text, &[0..5, 2..4, 3..4, 50..60]);
        assert_eq!(join_parts(&parts), text);
        assert_eq!(parts[0], TextPart::highlighted("café"));
    }

    #[test]
    fn adjacent_ranges_merge() {
        let parts = parts_from_byte_ranges("abcd", &[0..2, 2..4]);
        assert_eq!(parts, vec![TextPart::highlighted("abcd")]);
    }

    #[test]
    fn char_indices_over_unicode() {
        let text = "Café 日本語";
        let parts = parts_from_char_indices(text, &[3, 5, 6, 6]);
        assert_eq!(join_parts(&parts), text);
        assert_eq!(
            parts,
            vec![
                TextPart::plain("Caf"),
                TextPart::highlighted("é"),
                TextPart::plain(" "),
                TextPart::highlighted("日本"),
                TextPart::plain("語"),
            ]
        );
    }

    #[test]
    fn combining_marks_follow_their_base() {
        let text = "cafe\u{301}!";
        let parts = parts_from_char_indices(text, &[3]);
        assert_eq!(
            parts,
            vec![
                TextPart::plain("caf"),
                TextPart::highlighted("e\u{301}"),
                TextPart::plain("!"),
            ]
        );
    }

    #[test]
    fn empty_inputs() {
        assert!(parts_from_char_indices("", &[0]).is_empty());
        assert!(parts_from_byte_ranges("", &[]).is_empty());
        assert_eq!(
            parts_from_char_indices("ab", &[]),
            vec![TextPart::plain("ab")]
        );
    }
}
