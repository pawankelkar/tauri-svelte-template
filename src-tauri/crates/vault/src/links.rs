//! Link resolution (Obsidian semantics) and link rewriting on rename.

use std::collections::HashMap;

use percent_encoding::{utf8_percent_encode, AsciiSet, CONTROLS};
use serde::Serialize;

use crate::error::{VaultError, VaultResult};
use crate::fs::{hash_bytes, VaultFs};
use crate::parse::{parse_note, Link, LinkKind};
use crate::path::RelPath;

/// Characters escaped in rewritten markdown link destinations.
const MD_DEST: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'"')
    .add(b'#')
    .add(b'%')
    .add(b'(')
    .add(b')')
    .add(b'<')
    .add(b'>')
    .add(b'?')
    .add(b'[')
    .add(b']')
    .add(b'`');

/// A raw link target split into its parts, e.g. `Note#Intro|see`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetParts {
    pub target: String,
    pub heading: Option<String>,
    pub block: Option<String>,
    pub alias: Option<String>,
}

/// Splits `target#heading|alias` / `target#^block` (optionally wrapped in
/// `[[…]]` or `![[…]]`).
pub fn split_target(raw: &str) -> TargetParts {
    let mut s = raw.trim();
    s = s.strip_prefix('!').unwrap_or(s);
    if let Some(inner) = s.strip_prefix("[[").and_then(|x| x.strip_suffix("]]")) {
        s = inner;
    }
    let (link, alias) = match s.find('|') {
        Some(p) => (
            s[..p].strip_suffix('\\').unwrap_or(&s[..p]),
            Some(s[p + 1..].trim().to_string()).filter(|a| !a.is_empty()),
        ),
        None => (s, None),
    };
    let (target, sub) = match link.find('#') {
        Some(h) => (&link[..h], Some(link[h + 1..].trim())),
        None => (link, None),
    };
    let (heading, block) = match sub {
        Some(b) if b.starts_with('^') => (None, Some(b[1..].to_string())),
        Some(h) => (Some(h.to_string()), None),
        None => (None, None),
    };
    TargetParts {
        target: target.trim().to_string(),
        heading: heading.filter(|h| !h.is_empty()),
        block: block.filter(|b| !b.is_empty()),
        alias,
    }
}

/// Resolves a wikilink-style target (`#heading`/`|alias` are ignored) with
/// Obsidian semantics:
/// 1. exact vault path, with or without `.md`;
/// 2. relative to the linking note's folder;
/// 3. file name match (case-insensitive); a target with `/` matches as a
///    path suffix. Several matches: shortest path, then lexicographic.
///
/// Exact-case matches win over case-insensitive ones at each step. Empty
/// targets (same-note links) resolve to `None`; see [`resolve_link`].
pub fn resolve(target: &str, from: &RelPath, all_notes: &[RelPath]) -> Option<RelPath> {
    LinkResolver::new(all_notes).resolve(target, from).cloned()
}

/// Resolves a parsed link: markdown links relative to the note first,
/// wikilinks with [`resolve`]. Same-note links resolve to `from`.
pub fn resolve_link(link: &Link, from: &RelPath, all_notes: &[RelPath]) -> Option<RelPath> {
    LinkResolver::new(all_notes)
        .resolve_link(link, from)
        .cloned()
}

/// Precomputed lookup tables over a note list, for resolving many links.
pub struct LinkResolver<'a> {
    notes: &'a [RelPath],
    by_path: HashMap<String, Vec<usize>>,
    by_name: HashMap<String, Vec<usize>>,
}

impl<'a> LinkResolver<'a> {
    pub fn new(notes: &'a [RelPath]) -> Self {
        let mut by_path: HashMap<String, Vec<usize>> = HashMap::new();
        let mut by_name: HashMap<String, Vec<usize>> = HashMap::new();
        for (i, note) in notes.iter().enumerate() {
            by_path
                .entry(note.as_str().to_lowercase())
                .or_default()
                .push(i);
            by_name
                .entry(note.file_name().to_lowercase())
                .or_default()
                .push(i);
        }
        Self {
            notes,
            by_path,
            by_name,
        }
    }

    pub fn notes(&self) -> &'a [RelPath] {
        self.notes
    }

    /// See [`resolve`].
    pub fn resolve(&self, target: &str, from: &RelPath) -> Option<&'a RelPath> {
        let target = strip_subpath(target);
        if target.is_empty() {
            return None;
        }
        if let Some(abs) = target.strip_prefix('/') {
            return normalize("", abs).and_then(|p| self.exact(&p));
        }
        if let Some(found) = normalize("", target).and_then(|p| self.exact(&p)) {
            return Some(found);
        }
        if let Some(found) = normalize(from.parent_str(), target).and_then(|p| self.exact(&p)) {
            return Some(found);
        }
        self.by_suffix(target)
    }

    /// See [`resolve_link`].
    pub fn resolve_link(&self, link: &Link, from: &RelPath) -> Option<&'a RelPath> {
        if link.target.is_empty() {
            return self.notes.iter().find(|n| *n == from);
        }
        match link.kind {
            LinkKind::Wiki => self.resolve(&link.target, from),
            LinkKind::Markdown => self.resolve_markdown(&link.target, from),
        }
    }

    /// Markdown link destination (already URL-decoded): relative to the
    /// note's folder, then vault-absolute, then basename fallback.
    pub fn resolve_markdown(&self, dest: &str, from: &RelPath) -> Option<&'a RelPath> {
        if let Some(abs) = dest.strip_prefix('/') {
            return normalize("", abs).and_then(|p| self.exact(&p));
        }
        normalize(from.parent_str(), dest)
            .and_then(|p| self.exact(&p))
            .or_else(|| normalize("", dest).and_then(|p| self.exact(&p)))
            .or_else(|| self.by_suffix(dest))
    }

    fn exact(&self, path: &str) -> Option<&'a RelPath> {
        let mut candidates: Vec<String> = vec![path.to_string()];
        if !path.to_lowercase().ends_with(".md") {
            candidates.insert(0, format!("{path}.md"));
        }
        for candidate in &candidates {
            if let Some(ids) = self.by_path.get(&candidate.to_lowercase()) {
                let exact_case = ids.iter().find(|&&i| self.notes[i].as_str() == candidate);
                return Some(&self.notes[*exact_case.unwrap_or(&ids[0])]);
            }
        }
        None
    }

    fn by_suffix(&self, target: &str) -> Option<&'a RelPath> {
        let target = target.trim_start_matches("./");
        let lower = target.to_lowercase();
        let name = lower.rsplit('/').next().unwrap_or(&lower);
        let mut names = vec![name.to_string()];
        let mut suffixes = vec![lower.clone()];
        if !name.ends_with(".md") {
            names.insert(0, format!("{name}.md"));
            suffixes.insert(0, format!("{lower}.md"));
        }
        for (name, suffix) in names.iter().zip(&suffixes) {
            let Some(ids) = self.by_name.get(name) else {
                continue;
            };
            let best = ids
                .iter()
                .map(|&i| &self.notes[i])
                .filter(|note| {
                    let p = note.as_str().to_lowercase();
                    !target.contains('/') || p == *suffix || p.ends_with(&format!("/{suffix}"))
                })
                .min_by(|a, b| {
                    a.as_str()
                        .len()
                        .cmp(&b.as_str().len())
                        .then_with(|| a.as_str().cmp(b.as_str()))
                });
            if best.is_some() {
                return best;
            }
        }
        None
    }
}

/// Drops `#heading`, `#^block` and `|alias` from a target.
fn strip_subpath(target: &str) -> &str {
    let end = target.find(['#', '|']).unwrap_or(target.len());
    target[..end].trim().trim_end_matches('\\').trim()
}

/// Joins `rel` onto `base` (a folder path, `""` for root), resolving `.`
/// and `..`. `None` if it climbs above the root or is empty.
fn normalize(base: &str, rel: &str) -> Option<String> {
    let mut parts: Vec<&str> = base.split('/').filter(|s| !s.is_empty()).collect();
    for seg in rel.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            s => parts.push(s),
        }
    }
    (!parts.is_empty()).then(|| parts.join("/"))
}

/// Relative path from `from`'s folder to `to`, `/`-separated.
fn relative_path(from: &RelPath, to: &RelPath) -> String {
    let base: Vec<&str> = from
        .parent_str()
        .split('/')
        .filter(|s| !s.is_empty())
        .collect();
    let target: Vec<&str> = to.segments().collect();
    let common = base
        .iter()
        .zip(&target)
        .take_while(|(a, b)| a == b)
        .count()
        .min(target.len().saturating_sub(1));
    let mut out: Vec<&str> = vec![".."; base.len() - common];
    out.extend(&target[common..]);
    out.join("/")
}

/// Shortest wikilink target that resolves to `to` from `source`.
fn wiki_form(to: &RelPath, source: &RelPath, after: &LinkResolver<'_>, keep_ext: bool) -> String {
    let name = if keep_ext || !to.is_note() {
        to.file_name()
    } else {
        to.file_stem()
    };
    if after.resolve(name, source) == Some(to) {
        return name.to_string();
    }
    if keep_ext || !to.is_note() {
        to.as_str().to_string()
    } else {
        to.without_md().to_string()
    }
}

/// Rewrites the links of one note after a move. `source_before`/`after` is
/// the note's own path before/after (they differ when it moved itself).
/// Returns the new content and the number of links changed.
fn rewrite_moved(
    content: &str,
    source_before: &RelPath,
    source_after: &RelPath,
    before: &LinkResolver<'_>,
    after: &LinkResolver<'_>,
    map: &dyn Fn(&RelPath) -> RelPath,
) -> Option<(String, u32)> {
    let parsed = parse_note(content);
    let mut edits: Vec<(std::ops::Range<usize>, String)> = Vec::new();
    for link in &parsed.links {
        if link.target.is_empty() {
            continue;
        }
        let Some(original) = before.resolve_link(link, source_before) else {
            continue;
        };
        let desired = map(original);
        if after.resolve_link(link, source_after) == Some(&desired) {
            continue;
        }
        let replacement = match link.kind {
            LinkKind::Wiki => {
                let keep_ext = link.target.to_lowercase().ends_with(".md");
                wiki_form(&desired, source_after, after, keep_ext)
            }
            LinkKind::Markdown => {
                let rel = relative_path(source_after, &desired);
                let bracketed = link.target_range.start > 0
                    && content.as_bytes()[link.target_range.start - 1] == b'<';
                if bracketed {
                    rel
                } else {
                    utf8_percent_encode(&rel, MD_DEST).to_string()
                }
            }
        };
        if content.get(link.target_range.clone()) != Some(replacement.as_str()) {
            edits.push((link.target_range.clone(), replacement));
        }
    }
    if edits.is_empty() {
        return None;
    }
    let count = edits.len() as u32;
    let mut out = content.to_string();
    edits.sort_by_key(|(r, _)| std::cmp::Reverse(r.start));
    for (range, replacement) in edits {
        out.replace_range(range, &replacement);
    }
    Some((out, count))
}

/// Rewrites links in `content` (the note at `from`) that pointed at `old`
/// so they point at `new`, keeping alias, heading, block and embed marker.
/// Wikilinks get the shortest unambiguous form (file name if unique, else
/// the full path without `.md`), markdown links a relative path. Returns
/// `None` if nothing changed. Code blocks are never touched.
pub fn rewrite_links(
    content: &str,
    old: &RelPath,
    new: &RelPath,
    all_notes_after: &[RelPath],
    from: &RelPath,
) -> Option<String> {
    let before_list: Vec<RelPath> = all_notes_after
        .iter()
        .filter(|p| *p != new)
        .cloned()
        .chain(std::iter::once(old.clone()))
        .collect();
    let before = LinkResolver::new(&before_list);
    let after = LinkResolver::new(all_notes_after);
    let source_before = if from == new { old } else { from };
    let map = |p: &RelPath| if p == old { new.clone() } else { p.clone() };
    rewrite_moved(content, source_before, from, &before, &after, &map).map(|(s, _)| s)
}

/// What [`rename_with_links`] did.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameReport {
    pub new_path: RelPath,
    pub updated_files: u32,
    pub updated_links: u32,
    /// The (post-rename) paths of the notes whose links were rewritten, so
    /// callers can reindex exactly those.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub updated_paths: Vec<RelPath>,
}

/// Renames a note or folder and rewrites every link in the vault that
/// pointed into it (and relative markdown links inside moved notes).
/// Files that changed on disk mid-way are skipped (logged), not clobbered.
pub fn rename_with_links(fs: &VaultFs, from: &RelPath, to: &RelPath) -> VaultResult<RenameReport> {
    let before_list = fs.note_paths();
    fs.rename(from, to)?;
    let map = |p: &RelPath| p.rebase(from, to).unwrap_or_else(|| p.clone());
    let after_list: Vec<RelPath> = before_list.iter().map(map).collect();
    let mut report = RenameReport {
        new_path: to.clone(),
        updated_files: 0,
        updated_links: 0,
        updated_paths: Vec::new(),
    };
    let before = LinkResolver::new(&before_list);
    let after = LinkResolver::new(&after_list);
    for (source_before, source_after) in before_list.iter().zip(&after_list) {
        let content = match fs.read_to_string(source_after) {
            Ok(content) => content,
            Err(e) => {
                log::debug!("rename: skipping {source_after}: {e}");
                continue;
            }
        };
        if !content.contains("[[") && !content.contains("](") {
            continue;
        }
        let Some((updated, links)) =
            rewrite_moved(&content, source_before, source_after, &before, &after, &map)
        else {
            continue;
        };
        match fs.write_atomic(source_after, &updated, Some(&hash_bytes(&content))) {
            Ok(_) => {
                report.updated_files += 1;
                report.updated_links += links;
                report.updated_paths.push(source_after.clone());
            }
            Err(VaultError::Conflict { .. }) => {
                log::warn!("rename: {source_after} changed while rewriting links; skipped");
            }
            Err(e) => return Err(e),
        }
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths(list: &[&str]) -> Vec<RelPath> {
        list.iter().map(|p| RelPath::new(*p).unwrap()).collect()
    }

    fn rel(s: &str) -> RelPath {
        RelPath::new(s).unwrap()
    }

    fn res(target: &str, from: &str, all: &[RelPath]) -> Option<String> {
        resolve(target, &rel(from), all).map(RelPath::into_string)
    }

    #[test]
    fn split_target_parts() {
        let p = split_target("![[Folder/Note#Intro|see]]");
        assert_eq!(p.target, "Folder/Note");
        assert_eq!(p.heading.as_deref(), Some("Intro"));
        assert_eq!(p.alias.as_deref(), Some("see"));
        let p = split_target("Note#^blk");
        assert_eq!(p.block.as_deref(), Some("blk"));
        assert_eq!(split_target("#Local").target, "");
    }

    #[test]
    fn resolve_rules() {
        let all = paths(&[
            "Note.md",
            "a/Note.md",
            "a/b/Note.md",
            "a/Other.md",
            "b/Other.md",
            "x/Deep/Thing.md",
            "y/Thing.md",
            "Mixed.md",
            "img/pic.png",
        ]);
        // Exact vault path, with or without .md.
        assert_eq!(res("a/Note", "z.md", &all).as_deref(), Some("a/Note.md"));
        assert_eq!(res("a/Note.md", "z.md", &all).as_deref(), Some("a/Note.md"));
        // Exact root path beats relative.
        assert_eq!(res("Note", "a/b/src.md", &all).as_deref(), Some("Note.md"));
        // Relative to the source folder.
        assert_eq!(
            res("b/Note", "a/src.md", &all).as_deref(),
            Some("a/b/Note.md")
        );
        assert_eq!(
            res("../Other", "a/b/src.md", &all).as_deref(),
            Some("a/Other.md")
        );
        // Basename, case-insensitive; ties -> shortest then lexicographic.
        assert_eq!(res("other", "z.md", &all).as_deref(), Some("a/Other.md"));
        assert_eq!(res("thing", "z.md", &all).as_deref(), Some("y/Thing.md"));
        assert_eq!(res("MIXED", "z.md", &all).as_deref(), Some("Mixed.md"));
        // Path suffix.
        assert_eq!(
            res("Deep/Thing", "z.md", &all).as_deref(),
            Some("x/Deep/Thing.md")
        );
        // Heading / alias are ignored; non-notes resolve by full name.
        assert_eq!(
            res("Other#h|alias", "z.md", &all).as_deref(),
            Some("a/Other.md")
        );
        assert_eq!(res("pic.png", "z.md", &all).as_deref(), Some("img/pic.png"));
        assert_eq!(res("Missing", "z.md", &all), None);
        assert_eq!(res("", "z.md", &all), None);
        assert_eq!(res("../../../etc", "a/z.md", &all), None);
    }

    #[test]
    fn resolve_prefers_exact_case() {
        let all = paths(&["dir/note.md", "Dir/Note.md"]);
        assert_eq!(
            res("Dir/Note", "z.md", &all).as_deref(),
            Some("Dir/Note.md")
        );
        assert_eq!(
            res("dir/note", "z.md", &all).as_deref(),
            Some("dir/note.md")
        );
    }

    #[test]
    fn markdown_links_resolve_relative() {
        let all = paths(&["a/One.md", "One.md", "b/Two Words.md"]);
        let note = parse_note("[x](One.md) [y](../b/Two%20Words.md) [z](/One.md)");
        let from = rel("a/src.md");
        let got: Vec<Option<String>> = note
            .links
            .iter()
            .map(|l| resolve_link(l, &from, &all).map(RelPath::into_string))
            .collect();
        assert_eq!(
            got,
            [
                Some("a/One.md".into()),
                Some("b/Two Words.md".into()),
                Some("One.md".into())
            ]
        );
    }

    #[test]
    fn rewrite_preserves_alias_heading_embed_and_code() {
        let old = rel("Old Name.md");
        let new = rel("sub/New Name.md");
        let after = paths(&["sub/New Name.md", "src.md", "Other.md"]);
        let content = "[[Old Name]] [[Old Name|alias]] [[old name#Intro]] ![[Old Name#^blk|x]]\n\
                       [[Other]] [md](Old%20Name.md#Intro) [[Old Name.md]]\n\
                       ```\n[[Old Name]]\n```\n`[[Old Name]]`\n";
        let out = rewrite_links(content, &old, &new, &after, &rel("src.md")).unwrap();
        assert_eq!(
            out,
            "[[New Name]] [[New Name|alias]] [[New Name#Intro]] ![[New Name#^blk|x]]\n\
             [[Other]] [md](sub/New%20Name.md#Intro) [[New Name.md]]\n\
             ```\n[[Old Name]]\n```\n`[[Old Name]]`\n"
        );
        assert_eq!(
            rewrite_links("[[Other]] nothing", &old, &new, &after, &rel("src.md")),
            None
        );
    }

    #[test]
    fn rewrite_uses_full_path_when_ambiguous() {
        let old = rel("a/Topic.md");
        let new = rel("b/Topic.md");
        let after = paths(&["b/Topic.md", "Topic.md", "src.md"]);
        let out = rewrite_links("[[a/Topic]]", &old, &new, &after, &rel("src.md")).unwrap();
        assert_eq!(out, "[[b/Topic]]");
    }

    #[test]
    fn relative_paths() {
        assert_eq!(
            relative_path(&rel("a/b/s.md"), &rel("a/c/t.md")),
            "../c/t.md"
        );
        assert_eq!(relative_path(&rel("s.md"), &rel("a/t.md")), "a/t.md");
        assert_eq!(relative_path(&rel("a/s.md"), &rel("t.md")), "../t.md");
        assert_eq!(relative_path(&rel("a/s.md"), &rel("a/t.md")), "t.md");
    }

    fn setup(files: &[(&str, &str)]) -> (tempfile::TempDir, VaultFs) {
        let dir = tempfile::tempdir().unwrap();
        let fs = VaultFs::new(dir.path()).unwrap();
        for (p, c) in files {
            fs.write_atomic(&rel(p), c, None).unwrap();
        }
        (dir, fs)
    }

    #[test]
    fn rename_note_rewrites_inbound_links() {
        let (_d, fs) = setup(&[
            ("Target.md", "# Target\n"),
            ("a.md", "see [[Target|the target]] and [[Target#Intro]]\n"),
            (
                "dir/b.md",
                "![[Target]] [m](../Target.md)\n```\n[[Target]]\n```\n",
            ),
            ("c.md", "unrelated [[Other]]\n"),
        ]);
        let report = rename_with_links(&fs, &rel("Target.md"), &rel("Moved/Renamed.md")).unwrap();
        assert_eq!(report.new_path.as_str(), "Moved/Renamed.md");
        assert_eq!(report.updated_files, 2);
        assert_eq!(report.updated_links, 4);
        let updated: Vec<&str> = report.updated_paths.iter().map(RelPath::as_str).collect();
        assert_eq!(updated, ["a.md", "dir/b.md"]);
        assert_eq!(
            fs.read_to_string(&rel("a.md")).unwrap(),
            "see [[Renamed|the target]] and [[Renamed#Intro]]\n"
        );
        assert_eq!(
            fs.read_to_string(&rel("dir/b.md")).unwrap(),
            "![[Renamed]] [m](../Moved/Renamed.md)\n```\n[[Target]]\n```\n"
        );
        assert_eq!(
            fs.read_to_string(&rel("c.md")).unwrap(),
            "unrelated [[Other]]\n"
        );
        assert!(!fs.exists(&rel("Target.md")));
    }

    #[test]
    fn rename_folder_moves_notes_and_fixes_links() {
        let (_d, fs) = setup(&[
            (
                "Projects/Alpha.md",
                "[[Beta]] [rel](Beta.md) [up](../Index.md)\n",
            ),
            ("Projects/Beta.md", "beta\n"),
            ("Projects/Sub/Gamma.md", "gamma\n"),
            (
                "Index.md",
                "[[Projects/Alpha]] [[Gamma]] [g](Projects/Sub/Gamma.md)\n",
            ),
            ("Alpha.md", "a different alpha\n"),
        ]);
        let report = rename_with_links(&fs, &rel("Projects"), &rel("Archive/2024")).unwrap();
        assert_eq!(report.new_path.as_str(), "Archive/2024");
        assert_eq!(
            fs.read_to_string(&rel("Index.md")).unwrap(),
            "[[Archive/2024/Alpha]] [[Gamma]] [g](Archive/2024/Sub/Gamma.md)\n"
        );
        // Links inside the moved folder: relative ones still work, the one
        // leaving the folder is re-pointed.
        assert_eq!(
            fs.read_to_string(&rel("Archive/2024/Alpha.md")).unwrap(),
            "[[Beta]] [rel](Beta.md) [up](../../Index.md)\n"
        );
        assert_eq!(report.updated_files, 2);
        assert_eq!(report.updated_links, 3);
        assert!(fs.exists(&rel("Archive/2024/Sub/Gamma.md")));
    }

    #[test]
    fn rename_that_creates_ambiguity_disambiguates() {
        let (_d, fs) = setup(&[
            ("deep/Note.md", "deep\n"),
            ("src.md", "[[Note]]\n"),
            ("Draft.md", "draft\n"),
        ]);
        // A new, shorter `Note.md` would steal `[[Note]]`; keep it pointing
        // at the original.
        rename_with_links(&fs, &rel("Draft.md"), &rel("Note.md")).unwrap();
        assert_eq!(
            fs.read_to_string(&rel("src.md")).unwrap(),
            "[[deep/Note]]\n"
        );
    }

    #[test]
    fn rename_errors_propagate() {
        let (_d, fs) = setup(&[("a.md", "a"), ("b.md", "b")]);
        assert!(matches!(
            rename_with_links(&fs, &rel("a.md"), &rel("b.md")),
            Err(VaultError::AlreadyExists { .. })
        ));
    }
}
