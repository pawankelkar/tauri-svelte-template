//! Markdown parsing for indexing: frontmatter, title, headings, links,
//! tags, tasks and block ids.
//!
//! pulldown-cmark finds the structure (code blocks and spans, headings,
//! inline markdown links, task markers) with byte offsets. Everything
//! Obsidian-specific (wikilinks, tags, block ids) is then scanned by hand
//! over a copy of the text in which frontmatter and code are blanked out
//! with spaces, so byte offsets and line numbers stay identical to the
//! original and nothing inside code is ever picked up.

use std::collections::{HashMap, HashSet};
use std::ops::Range;

use percent_encoding::percent_decode_str;
use pulldown_cmark::{Event, LinkType, Options, Parser, Tag, TagEnd};
use serde::Serialize;
use serde_json::Value;

/// Max length of [`Link::context`], in characters.
pub const CONTEXT_MAX_CHARS: usize = 300;

#[derive(Debug, Clone, PartialEq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedNote {
    /// YAML frontmatter as JSON; `None` if absent or invalid.
    pub frontmatter: Option<Value>,
    /// Frontmatter `title`, else the first H1. Callers fall back to the
    /// file stem.
    pub title: Option<String>,
    pub headings: Vec<Heading>,
    /// Wikilinks, embeds and markdown links to local `.md` files, in source
    /// order.
    pub links: Vec<Link>,
    /// Lowercase, de-duplicated; frontmatter tags first, then inline ones.
    pub tags: Vec<String>,
    pub tasks: Vec<Task>,
    pub block_ids: Vec<BlockId>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Heading {
    pub level: u32,
    pub text: String,
    /// 0-based line over the whole file (frontmatter included).
    pub line: u32,
    /// GitHub-style anchor, de-duplicated with `-1`, `-2`, …
    pub slug: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LinkKind {
    /// `[[target]]` / `![[target]]`
    Wiki,
    /// `[text](path/to/note.md)`; `target` is URL-decoded and relative to
    /// the linking note's folder (or the vault root with a leading `/`).
    Markdown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Link {
    /// The whole link as written, e.g. `![[Note#Intro|see]]`.
    pub raw: String,
    /// Target path/name without heading, block or alias. Empty for
    /// same-note links like `[[#Heading]]`.
    pub target: String,
    pub heading: Option<String>,
    /// Block id without the `^`.
    pub block: Option<String>,
    /// `|alias` for wikilinks, the link text for markdown links.
    pub alias: Option<String>,
    pub is_embed: bool,
    pub kind: LinkKind,
    /// 0-based line of the link.
    pub line: u32,
    /// The link's line, trimmed, at most [`CONTEXT_MAX_CHARS`] characters.
    pub context: String,
    /// Byte range of the target text inside the source (what a rename
    /// rewrites). For markdown links this is the still-encoded path part.
    #[serde(skip)]
    pub target_range: Range<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub line: u32,
    pub text: String,
    pub done: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockId {
    /// Without the `^`.
    pub id: String,
    pub line: u32,
}

/// Parses a note. Never panics; malformed input just yields less data.
pub fn parse_note(content: &str) -> ParsedNote {
    let lines = LineIndex::new(content);
    let mut masked = content.as_bytes().to_vec();

    // BOM + frontmatter.
    let bom = if content.starts_with('\u{feff}') {
        3
    } else {
        0
    };
    blank(&mut masked, 0..bom);
    let (frontmatter, fm_range) = match split_frontmatter(content, bom) {
        Some((yaml, range)) => (parse_yaml(yaml), Some(range)),
        None => (None, None),
    };
    if let Some(range) = fm_range {
        blank(&mut masked, range);
    }

    let body = std::str::from_utf8(&masked).unwrap_or_default().to_string();
    let structure = scan_structure(&body);

    for range in &structure.code {
        blank(&mut masked, range.clone());
    }
    // Only ASCII spaces were written over whole UTF-8 sequences, so this
    // is still valid UTF-8.
    let code_free = String::from_utf8(masked).unwrap_or_default();

    let mut links = Vec::new();
    let mut tag_text = code_free.clone().into_bytes();
    for wl in scan_wikilinks(&code_free) {
        blank(&mut tag_text, wl.whole.clone());
        links.push(wl.into_link(content, &lines));
    }
    for md in &structure.md_links {
        blank(&mut tag_text, md.dest.clone());
        if let Some(link) = markdown_link(content, md, &lines) {
            links.push(link);
        }
    }
    links.sort_by_key(|l| l.target_range.start);
    let tag_text = String::from_utf8(tag_text).unwrap_or_default();

    let headings = build_headings(&structure.headings, &lines);

    let mut tags = Vec::new();
    let mut seen = HashSet::new();
    if let Some(fm) = &frontmatter {
        for tag in frontmatter_tags(fm) {
            if seen.insert(tag.clone()) {
                tags.push(tag);
            }
        }
    }
    for tag in scan_tags(&tag_text) {
        if seen.insert(tag.clone()) {
            tags.push(tag);
        }
    }

    let tasks = structure
        .tasks
        .iter()
        .map(|(offset, done)| {
            let line = lines.line_of(*offset);
            let end = lines.line_end(content, line);
            let text = content
                .get(*offset..end)
                .unwrap_or_default()
                .trim()
                .to_string();
            Task {
                line: line as u32,
                text,
                done: *done,
            }
        })
        .collect();

    let block_ids = scan_block_ids(&tag_text);

    let title = frontmatter
        .as_ref()
        .and_then(|fm| fm.get("title"))
        .and_then(|t| match t {
            Value::String(s) => Some(s.trim().to_string()),
            Value::Number(n) => Some(n.to_string()),
            _ => None,
        })
        .filter(|t| !t.is_empty())
        .or_else(|| {
            headings
                .iter()
                .find(|h| h.level == 1 && !h.text.is_empty())
                .map(|h| h.text.clone())
        });

    ParsedNote {
        frontmatter,
        title,
        headings,
        links,
        tags,
        tasks,
        block_ids,
    }
}

/// GitHub-style heading slug (without de-duplication): lowercase, spaces to
/// `-`, everything but letters, digits, `-` and `_` dropped.
pub fn slugify(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.trim().chars() {
        if c.is_alphanumeric() || c == '-' || c == '_' {
            out.extend(c.to_lowercase());
        } else if c == ' ' {
            out.push('-');
        }
    }
    out
}

// ---- line bookkeeping -----------------------------------------------------

pub(crate) struct LineIndex {
    starts: Vec<usize>,
}

impl LineIndex {
    pub(crate) fn new(text: &str) -> Self {
        let mut starts = vec![0];
        starts.extend(text.match_indices('\n').map(|(i, _)| i + 1));
        Self { starts }
    }

    pub(crate) fn line_of(&self, offset: usize) -> usize {
        self.starts
            .partition_point(|&s| s <= offset)
            .saturating_sub(1)
    }

    fn line_start(&self, line: usize) -> usize {
        self.starts.get(line).copied().unwrap_or(0)
    }

    /// End of `line`, excluding `\n` / `\r\n`.
    fn line_end(&self, text: &str, line: usize) -> usize {
        let mut end = self
            .starts
            .get(line + 1)
            .map(|s| s - 1)
            .unwrap_or(text.len());
        if end > 0 && text.as_bytes().get(end - 1) == Some(&b'\r') {
            end -= 1;
        }
        end
    }

    fn context(&self, text: &str, line: usize) -> String {
        let raw = text
            .get(self.line_start(line)..self.line_end(text, line))
            .unwrap_or_default()
            .trim();
        raw.chars().take(CONTEXT_MAX_CHARS).collect()
    }
}

/// Overwrites `range` with spaces, keeping newlines.
fn blank(bytes: &mut [u8], range: Range<usize>) {
    let end = range.end.min(bytes.len());
    for b in &mut bytes[range.start.min(end)..end] {
        if *b != b'\n' && *b != b'\r' {
            *b = b' ';
        }
    }
}

// ---- frontmatter ----------------------------------------------------------

/// `content` without its leading BOM and YAML frontmatter block (if any):
/// the text a full-text index should see.
pub fn strip_frontmatter(content: &str) -> &str {
    let bom = if content.starts_with('\u{feff}') {
        3
    } else {
        0
    };
    match split_frontmatter(content, bom) {
        Some((_, range)) => &content[range.end..],
        None => &content[bom..],
    }
}

/// Returns the YAML text and the byte range of the whole frontmatter block
/// (both fences included).
fn split_frontmatter(content: &str, start: usize) -> Option<(&str, Range<usize>)> {
    let rest = &content[start..];
    let first_end = rest.find('\n')?;
    if rest[..first_end].trim_end() != "---" {
        return None;
    }
    let yaml_start = start + first_end + 1;
    let mut pos = yaml_start;
    while pos <= content.len() {
        let line_end = content[pos..]
            .find('\n')
            .map(|i| pos + i)
            .unwrap_or(content.len());
        let line = content[pos..line_end].trim_end();
        if line == "---" || line == "..." {
            let block_end = (line_end + 1).min(content.len());
            return Some((&content[yaml_start..pos], start..block_end));
        }
        if line_end >= content.len() {
            break;
        }
        pos = line_end + 1;
    }
    None
}

fn parse_yaml(yaml: &str) -> Option<Value> {
    if yaml.trim().is_empty() {
        return Some(Value::Object(Default::default()));
    }
    match serde_norway::from_str::<Value>(yaml) {
        Ok(Value::Null) => Some(Value::Object(Default::default())),
        Ok(value @ Value::Object(_)) => Some(value),
        _ => None,
    }
}

fn frontmatter_tags(fm: &Value) -> Vec<String> {
    let mut out = Vec::new();
    let Value::Object(map) = fm else {
        return out;
    };
    for (key, value) in map {
        if !matches!(key.to_lowercase().as_str(), "tags" | "tag") {
            continue;
        }
        let mut push = |s: &str| {
            for part in s.split(|c: char| c == ',' || c.is_whitespace()) {
                let tag = part.trim().trim_start_matches('#').trim_end_matches('/');
                if !tag.is_empty() {
                    out.push(tag.to_lowercase());
                }
            }
        };
        match value {
            Value::String(s) => push(s),
            Value::Number(n) => push(&n.to_string()),
            Value::Array(items) => {
                for item in items {
                    match item {
                        Value::String(s) => push(s),
                        Value::Number(n) => push(&n.to_string()),
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }
    out
}

// ---- pulldown-cmark pass --------------------------------------------------

struct MdLinkSpan {
    whole: Range<usize>,
    /// The destination (inside `<…>` when bracketed).
    dest: Range<usize>,
    text: String,
    is_image: bool,
}

#[derive(Default)]
struct Structure {
    code: Vec<Range<usize>>,
    /// (level, start offset, text)
    headings: Vec<(u32, usize, String)>,
    md_links: Vec<MdLinkSpan>,
    /// (offset just after the `[ ]` marker, done)
    tasks: Vec<(usize, bool)>,
}

fn scan_structure(text: &str) -> Structure {
    let options = Options::ENABLE_TABLES
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_FOOTNOTES;
    let mut out = Structure::default();
    let mut heading: Option<(u32, usize, String)> = None;
    let mut link: Option<(Range<usize>, String, bool)> = None;

    for (event, range) in Parser::new_ext(text, options).into_offset_iter() {
        match event {
            Event::Start(Tag::CodeBlock(_)) => out.code.push(range),
            Event::Code(code) => {
                out.code.push(range);
                if let Some((_, _, t)) = heading.as_mut() {
                    t.push_str(&code);
                }
                if let Some((_, t, _)) = link.as_mut() {
                    t.push_str(&code);
                }
            }
            Event::Start(Tag::Heading { level, .. }) => {
                heading = Some((level as u32, range.start, String::new()));
            }
            Event::End(TagEnd::Heading(_)) => {
                if let Some((level, start, text)) = heading.take() {
                    out.headings.push((level, start, text.trim().to_string()));
                }
            }
            Event::Start(Tag::Link {
                link_type: LinkType::Inline,
                ..
            }) => link = Some((range, String::new(), false)),
            Event::Start(Tag::Image {
                link_type: LinkType::Inline,
                ..
            }) => link = Some((range, String::new(), true)),
            Event::End(TagEnd::Link) | Event::End(TagEnd::Image) => {
                if let Some((whole, label, is_image)) = link.take() {
                    if let Some(dest) = inline_dest(&text[whole.clone()], &whole) {
                        out.md_links.push(MdLinkSpan {
                            whole,
                            dest,
                            text: label.trim().to_string(),
                            is_image,
                        });
                    }
                }
            }
            Event::Text(t) => {
                if let Some((_, _, h)) = heading.as_mut() {
                    h.push_str(&t);
                }
                if let Some((_, l, _)) = link.as_mut() {
                    l.push_str(&t);
                }
            }
            Event::SoftBreak | Event::HardBreak => {
                if let Some((_, _, h)) = heading.as_mut() {
                    h.push(' ');
                }
            }
            Event::TaskListMarker(done) => out.tasks.push((range.end, done)),
            _ => {}
        }
    }

    out
}

/// Locates the destination of an inline link `[text](dest "title")` given
/// the link's source text. Returns an absolute byte range.
fn inline_dest(src: &str, whole: &Range<usize>) -> Option<Range<usize>> {
    if !src.ends_with(')') {
        return None;
    }
    let open = src.rfind("](")? + 2;
    let inner_end = src.len() - 1;
    let inner = &src[open..inner_end];
    let lead = inner.len() - inner.trim_start().len();
    let start = open + lead;
    let rest = &src[start..inner_end];
    let (s, e) = if let Some(stripped) = rest.strip_prefix('<') {
        let close = stripped.find('>')?;
        (start + 1, start + 1 + close)
    } else {
        let len = rest.find(char::is_whitespace).unwrap_or(rest.len());
        (start, start + len)
    };
    Some(whole.start + s..whole.start + e)
}

fn markdown_link(content: &str, span: &MdLinkSpan, lines: &LineIndex) -> Option<Link> {
    let dest = content.get(span.dest.clone())?;
    if dest.is_empty() || has_scheme(dest) || dest.starts_with("//") {
        return None;
    }
    let (path_part, fragment) = match dest.find('#') {
        Some(i) => (&dest[..i], Some(&dest[i + 1..])),
        None => (dest, None),
    };
    let path_part = path_part.split('?').next().unwrap_or_default();
    if path_part.is_empty() {
        return None;
    }
    let target = percent_decode_str(path_part)
        .decode_utf8_lossy()
        .into_owned();
    if !target.to_lowercase().ends_with(".md") {
        return None;
    }
    let fragment = fragment
        .map(|f| percent_decode_str(f).decode_utf8_lossy().trim().to_string())
        .filter(|f| !f.is_empty());
    let (heading, block) = match fragment {
        Some(f) => match f.strip_prefix('^') {
            Some(b) => (None, Some(b.to_string())),
            None => (Some(f), None),
        },
        None => (None, None),
    };
    let line = lines.line_of(span.whole.start);
    let start = span.dest.start;
    Some(Link {
        raw: content.get(span.whole.clone())?.to_string(),
        target,
        heading,
        block,
        alias: Some(span.text.clone()).filter(|t| !t.is_empty()),
        is_embed: span.is_image,
        kind: LinkKind::Markdown,
        line: line as u32,
        context: lines.context(content, line),
        target_range: start..start + path_part.len(),
    })
}

fn has_scheme(dest: &str) -> bool {
    let Some(colon) = dest.find(':') else {
        return false;
    };
    let scheme = &dest[..colon];
    !scheme.is_empty()
        && scheme
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphabetic())
        && scheme
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'))
}

// ---- headings -------------------------------------------------------------

fn build_headings(raw: &[(u32, usize, String)], lines: &LineIndex) -> Vec<Heading> {
    let mut used: HashSet<String> = HashSet::new();
    let mut counts: HashMap<String, u32> = HashMap::new();
    raw.iter()
        .map(|(level, start, text)| {
            let base = slugify(text);
            let mut slug = base.clone();
            if used.contains(&slug) {
                let n = counts.entry(base.clone()).or_insert(0);
                loop {
                    *n += 1;
                    slug = format!("{base}-{n}");
                    if !used.contains(&slug) {
                        break;
                    }
                }
            }
            used.insert(slug.clone());
            Heading {
                level: *level,
                text: text.clone(),
                line: lines.line_of(*start) as u32,
                slug,
            }
        })
        .collect()
}

// ---- wikilinks ------------------------------------------------------------

struct WikiSpan {
    /// `[[…]]` plus the leading `!` for embeds.
    whole: Range<usize>,
    target: Range<usize>,
    heading: Option<String>,
    block: Option<String>,
    alias: Option<String>,
    is_embed: bool,
}

impl WikiSpan {
    fn into_link(self, content: &str, lines: &LineIndex) -> Link {
        let line = lines.line_of(self.whole.start);
        Link {
            raw: content[self.whole.clone()].to_string(),
            target: content[self.target.clone()].to_string(),
            heading: self.heading,
            block: self.block,
            alias: self.alias,
            is_embed: self.is_embed,
            kind: LinkKind::Wiki,
            line: line as u32,
            context: lines.context(content, line),
            target_range: self.target,
        }
    }
}

/// Finds `[[…]]` on single lines of `text` (code already blanked).
fn scan_wikilinks(text: &str) -> Vec<WikiSpan> {
    let bytes = text.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while let Some(found) = text[i..].find("[[") {
        let open = i + found;
        let inner_start = open + 2;
        let line_end = text[inner_start..]
            .find('\n')
            .map(|n| inner_start + n)
            .unwrap_or(text.len());
        let Some(close_rel) = text[inner_start..line_end].find("]]") else {
            i = inner_start;
            continue;
        };
        let inner_end = inner_start + close_rel;
        // `[[a [[b]]`: restart at the innermost opener.
        if let Some(nested) = text[inner_start..inner_end].rfind("[[") {
            i = inner_start + nested;
            continue;
        }
        let escaped = open > 0 && bytes[open - 1] == b'\\';
        let is_embed = !escaped && open > 0 && bytes[open - 1] == b'!';
        if !escaped {
            if let Some(span) = parse_wiki_inner(text, inner_start..inner_end, open, is_embed) {
                out.push(span);
            }
        }
        i = inner_end + 2;
    }
    out
}

fn parse_wiki_inner(
    text: &str,
    inner: Range<usize>,
    open: usize,
    is_embed: bool,
) -> Option<WikiSpan> {
    let body = &text[inner.clone()];
    // Alias after the first `|`; `\|` (escaped for tables) counts too.
    let (link_len, alias) = match body.find('|') {
        Some(p) => {
            let link_len = if body[..p].ends_with('\\') { p - 1 } else { p };
            let alias = body[p + 1..].trim();
            (link_len, Some(alias.to_string()).filter(|a| !a.is_empty()))
        }
        None => (body.len(), None),
    };
    let link = &body[..link_len];
    let (target_len, sub) = match link.find('#') {
        Some(h) => (h, Some(link[h + 1..].trim())),
        None => (link.len(), None),
    };
    let raw_target = &link[..target_len];
    let lead = raw_target.len() - raw_target.trim_start().len();
    let trimmed = raw_target.trim();
    let target_start = inner.start + lead;
    let target = target_start..target_start + trimmed.len();

    let (heading, block) = match sub {
        Some(s) if s.starts_with('^') => (None, Some(s[1..].trim().to_string())),
        Some(s) => (Some(s.to_string()), None),
        None => (None, None),
    };
    let heading = heading.filter(|h| !h.is_empty());
    let block = block.filter(|b| !b.is_empty());
    if trimmed.is_empty() && heading.is_none() && block.is_none() {
        return None;
    }
    let start = if is_embed { open - 1 } else { open };
    Some(WikiSpan {
        whole: start..inner.end + 2,
        target,
        heading,
        block,
        alias,
        is_embed,
    })
}

// ---- tags & block ids -----------------------------------------------------

fn is_tag_char(c: char) -> bool {
    c.is_alphanumeric() || matches!(c, '_' | '-' | '/')
}

fn scan_tags(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut prev: Option<char> = None;
    let mut chars = text.char_indices().peekable();
    while let Some((i, c)) = chars.next() {
        let at_boundary = prev.is_none_or(char::is_whitespace);
        prev = Some(c);
        if c != '#' || !at_boundary {
            continue;
        }
        let rest = &text[i + 1..];
        let len: usize = rest
            .chars()
            .take_while(|&c| is_tag_char(c))
            .map(char::len_utf8)
            .sum();
        let tag = rest[..len].trim_end_matches('/');
        let meaningful = tag.chars().any(|c| !c.is_ascii_digit() && c != '/');
        if !tag.is_empty() && meaningful && !tag.starts_with('/') {
            out.push(tag.to_lowercase());
        }
        // Skip the tag body so `#a#b` doesn't yield `b`.
        while chars.peek().is_some_and(|&(j, _)| j < i + 1 + len) {
            let (_, c) = chars.next().unwrap_or_default();
            prev = Some(c);
        }
    }
    out
}

fn scan_block_ids(text: &str) -> Vec<BlockId> {
    let mut out = Vec::new();
    for (line, raw) in text.split('\n').enumerate() {
        let trimmed = raw.trim_end();
        let Some(caret) = trimmed.rfind('^') else {
            continue;
        };
        let id = &trimmed[caret + 1..];
        let before_ok = caret == 0 || trimmed[..caret].ends_with(char::is_whitespace);
        if before_ok && !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        {
            out.push(BlockId {
                id: id.to_string(),
                line: line as u32,
            });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn targets(note: &ParsedNote) -> Vec<&str> {
        note.links.iter().map(|l| l.target.as_str()).collect()
    }

    #[test]
    fn strip_frontmatter_drops_bom_and_yaml_only() {
        assert_eq!(
            strip_frontmatter("---\ntitle: x\n---\n# Body\n"),
            "# Body\n"
        );
        assert_eq!(strip_frontmatter("\u{feff}---\na: 1\n...\nrest"), "rest");
        assert_eq!(strip_frontmatter("\u{feff}plain"), "plain");
        assert_eq!(strip_frontmatter("no fm\n---\n"), "no fm\n---\n");
        assert_eq!(strip_frontmatter("---\nunclosed\n"), "---\nunclosed\n");
    }

    #[test]
    fn wikilinks_with_alias_heading_block_and_embeds() {
        let src = "See [[Note A]] and [[Folder/Note B|B]].\n\
                   Jump [[Note C#Section 2]] or [[Note D#^abc123|blk]].\n\
                   Here: [[#Local heading]] and ![[image.png]] ![[Note E#Part]]\n";
        let note = parse_note(src);
        assert_eq!(
            targets(&note),
            [
                "Note A",
                "Folder/Note B",
                "Note C",
                "Note D",
                "",
                "image.png",
                "Note E"
            ]
        );
        let l = &note.links;
        assert_eq!(l[1].alias.as_deref(), Some("B"));
        assert_eq!(l[2].heading.as_deref(), Some("Section 2"));
        assert_eq!(l[3].block.as_deref(), Some("abc123"));
        assert_eq!(l[3].alias.as_deref(), Some("blk"));
        assert_eq!(l[4].heading.as_deref(), Some("Local heading"));
        assert!(l[5].is_embed && l[6].is_embed && !l[0].is_embed);
        assert_eq!(l[5].raw, "![[image.png]]");
        assert_eq!(l[6].heading.as_deref(), Some("Part"));
        assert_eq!(l[0].line, 0);
        assert_eq!(l[2].line, 1);
        assert_eq!(l[5].line, 2);
        assert_eq!(l[0].context, "See [[Note A]] and [[Folder/Note B|B]].");
        assert_eq!(&src[l[1].target_range.clone()], "Folder/Note B");
        assert!(l.iter().all(|l| l.kind == LinkKind::Wiki));
    }

    #[test]
    fn wikilink_edge_cases() {
        let note = parse_note(
            "[[]] [[ spaced |alias ]] \\[[escaped]] [[a\n b]] [[x [[inner]]\n| [[T\\|table alias]] |\n",
        );
        assert_eq!(targets(&note), ["spaced", "inner", "T"]);
        assert_eq!(note.links[0].alias.as_deref(), Some("alias"));
        assert_eq!(note.links[2].alias.as_deref(), Some("table alias"));
    }

    #[test]
    fn code_is_ignored() {
        let src = "```\n[[InFence]] #fencetag\n- [ ] not a task\n```\n\
                   ~~~md\n[[Tilde]]\n~~~\n\
                   Use `[[InlineCode]]` and `#codetag` but [[Real]] #realtag\n\
                   \n    [[Indented]] #indented\n";
        let note = parse_note(src);
        assert_eq!(targets(&note), ["Real"]);
        assert_eq!(note.tags, ["realtag"]);
        assert!(note.tasks.is_empty());
        assert_eq!(note.links[0].line, 7);
    }

    #[test]
    fn markdown_links_to_local_notes() {
        let src = "[One](one.md) [Two](sub/Two%20Words.md#Some%20Heading) \
                   [Web](https://example.com/a.md) [Mail](mailto:x@y.md) [Img](pic.png) \
                   [Angle](<../Up Here.md>) ![embed](e.md) [frag](#local) `[c](code.md)`\n";
        let note = parse_note(src);
        assert_eq!(
            targets(&note),
            ["one.md", "sub/Two Words.md", "../Up Here.md", "e.md"]
        );
        let two = &note.links[1];
        assert_eq!(two.kind, LinkKind::Markdown);
        assert_eq!(two.heading.as_deref(), Some("Some Heading"));
        assert_eq!(two.alias.as_deref(), Some("Two"));
        assert_eq!(&src[two.target_range.clone()], "sub/Two%20Words.md");
        assert_eq!(&src[note.links[2].target_range.clone()], "../Up Here.md");
        assert!(note.links[3].is_embed);
    }

    #[test]
    fn tags() {
        let src = "#top and #Nested/Deep/ plus #123 #1a #y2024 \
                   url http://x.com/#frag a#notatag \\#escaped #-dash #日本語\n\
                   # Heading #inheading\n\
                   ## \n\
                   [[Note#heading]] [x](a.md#frag) `#code` #dup #DUP #a#b\n";
        let note = parse_note(src);
        assert_eq!(
            note.tags,
            [
                "top",
                "nested/deep",
                "1a",
                "y2024",
                "-dash",
                "日本語",
                "inheading",
                "dup",
                "a"
            ]
        );
    }

    #[test]
    fn frontmatter_title_and_tags() {
        let src = "---\ntitle: From FM\ntags: [Alpha, \"#beta\", nested/x]\naliases: [a]\n---\n# H1 Title\n#inline [[Link]]\n";
        let note = parse_note(src);
        let fm = note.frontmatter.as_ref().unwrap();
        assert_eq!(fm["title"], "From FM");
        assert_eq!(note.title.as_deref(), Some("From FM"));
        assert_eq!(note.tags, ["alpha", "beta", "nested/x", "inline"]);
        assert_eq!(note.headings[0].line, 5);
        assert_eq!(note.links[0].line, 6);

        let note = parse_note("---\ntags: one, two three\n---\nbody #two\n");
        assert_eq!(note.tags, ["one", "two", "three"]);
        assert_eq!(note.title, None);

        let note = parse_note("# First\n\n# Second\n");
        assert_eq!(note.title.as_deref(), Some("First"));
    }

    #[test]
    fn frontmatter_edge_cases() {
        // Invalid YAML: no frontmatter value, but the block is still not body.
        let note = parse_note("---\ntitle: [unclosed\n  - : :\n---\n# Real\n[[x]]\n");
        assert_eq!(note.frontmatter, None);
        assert_eq!(note.title.as_deref(), Some("Real"));
        assert_eq!(targets(&note), ["x"]);
        // Frontmatter content never counts as tags/links.
        let note = parse_note("---\nnote: \"#nottag [[notlink]]\"\n---\nbody\n");
        assert!(note.tags.is_empty() && note.links.is_empty());
        // Empty frontmatter.
        let note = parse_note("---\n---\ntext\n");
        assert_eq!(note.frontmatter, Some(serde_json::json!({})));
        // Unterminated: not frontmatter; `---` is a thematic break.
        let note = parse_note("---\ntitle: x\n");
        assert_eq!(note.frontmatter, None);
        // Scalar YAML is not frontmatter.
        assert_eq!(parse_note("---\njust text\n---\n").frontmatter, None);
        // CRLF + BOM.
        let note = parse_note("\u{feff}---\r\ntitle: Win\r\n---\r\n# H\r\n");
        assert_eq!(note.title.as_deref(), Some("Win"));
        assert_eq!(note.headings[0].line, 3);
        // Not at the very top.
        assert_eq!(parse_note("\n---\na: 1\n---\n").frontmatter, None);
    }

    #[test]
    fn headings_setext_and_slugs() {
        let src = "Intro\n=====\n\n## Hello, World!\n\nSub\n---\n\n## Hello World\n### hello world\n#### `code` *em*\n";
        let note = parse_note(src);
        let h: Vec<(u32, &str, u32, &str)> = note
            .headings
            .iter()
            .map(|h| (h.level, h.text.as_str(), h.line, h.slug.as_str()))
            .collect();
        assert_eq!(
            h,
            [
                (1, "Intro", 0, "intro"),
                (2, "Hello, World!", 3, "hello-world"),
                (2, "Sub", 5, "sub"),
                (2, "Hello World", 8, "hello-world-1"),
                (3, "hello world", 9, "hello-world-2"),
                (4, "code em", 10, "code-em"),
            ]
        );
        assert_eq!(note.title.as_deref(), Some("Intro"));
    }

    #[test]
    fn tasks() {
        let src = "- [ ] open one\n* [x] done two\n+ [X] done three\n1. [ ] numbered\n  - [ ] nested\n> - [x] quoted\n- [] not\n-[ ] not\ntext [ ] not\n";
        let note = parse_note(src);
        let t: Vec<(u32, &str, bool)> = note
            .tasks
            .iter()
            .map(|t| (t.line, t.text.as_str(), t.done))
            .collect();
        assert_eq!(
            t,
            [
                (0, "open one", false),
                (1, "done two", true),
                (2, "done three", true),
                (3, "numbered", false),
                (4, "nested", false),
                (5, "quoted", true),
            ]
        );
    }

    #[test]
    fn block_ids() {
        let src = "A paragraph ^para-1\nno^id\n^solo\n```\ncode ^incode\n```\n[[x#^ref]]\n";
        let note = parse_note(src);
        let ids: Vec<(&str, u32)> = note
            .block_ids
            .iter()
            .map(|b| (b.id.as_str(), b.line))
            .collect();
        assert_eq!(ids, [("para-1", 0), ("solo", 2)]);
    }

    #[test]
    fn context_is_trimmed_and_capped() {
        let long = format!("   [[x]] {}", "y".repeat(400));
        let note = parse_note(&long);
        assert_eq!(note.links[0].context.chars().count(), CONTEXT_MAX_CHARS);
        assert!(note.links[0].context.starts_with("[[x]]"));
    }

    #[test]
    fn never_panics_on_junk() {
        for src in [
            "",
            "---",
            "---\n",
            "[[",
            "]]",
            "![[",
            "[[|]]",
            "[[#]]",
            "[[#^]]",
            "#",
            "# ",
            "^",
            "`",
            "```",
            "[a](",
            "[a](<b.md",
            "---\n---",
            "\u{feff}",
            "é[[é|é]]é #é",
        ] {
            let _ = parse_note(src);
        }
    }
}
