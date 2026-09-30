use std::fmt;
use std::path::{Component, Path};

use serde::{Deserialize, Serialize};

use crate::error::{VaultError, VaultResult};

/// Longest accepted vault-relative path, in bytes.
pub const MAX_PATH_LEN: usize = 1024;
/// Longest accepted single path segment, in bytes (APFS/ext4/NTFS limit).
pub const MAX_SEGMENT_LEN: usize = 255;

const WINDOWS_RESERVED: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// A validated vault-relative path: `/`-separated, no leading slash, no `.`
/// or `..` segments, no empty segments, no backslashes, NUL or control
/// characters, no Windows device names, bounded length.
///
/// Validation is purely lexical; [`crate::VaultFs`] additionally checks
/// containment against the canonicalised vault root (symlinks).
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct RelPath(String);

impl RelPath {
    pub fn new(path: impl Into<String>) -> VaultResult<Self> {
        let path = path.into();
        validate(&path)?;
        Ok(Self(path))
    }

    /// Builds a `RelPath` from an OS path relative to the vault root (as
    /// produced by `strip_prefix`). Fails on non-UTF-8 names.
    pub fn from_os_relative(path: &Path) -> VaultResult<Self> {
        let mut parts = Vec::new();
        for component in path.components() {
            match component {
                Component::Normal(part) => parts.push(part.to_str().ok_or_else(|| {
                    VaultError::invalid_path(path.to_string_lossy(), "not valid UTF-8")
                })?),
                _ => {
                    return Err(VaultError::invalid_path(
                        path.to_string_lossy(),
                        "not a plain relative path",
                    ))
                }
            }
        }
        Self::new(parts.join("/"))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn into_string(self) -> String {
        self.0
    }

    /// Path segments, root first.
    pub fn segments(&self) -> impl Iterator<Item = &str> {
        self.0.split('/')
    }

    /// Last segment, e.g. `Note.md`.
    pub fn file_name(&self) -> &str {
        self.0.rsplit('/').next().unwrap_or(&self.0)
    }

    /// File name without its last extension, e.g. `Note` for `a/Note.md`.
    pub fn file_stem(&self) -> &str {
        let name = self.file_name();
        match name.rfind('.') {
            Some(0) | None => name,
            Some(i) => &name[..i],
        }
    }

    /// Extension without the dot, if any.
    pub fn extension(&self) -> Option<&str> {
        let name = self.file_name();
        match name.rfind('.') {
            Some(0) | None => None,
            Some(i) => Some(&name[i + 1..]),
        }
    }

    /// True for `*.md` (case-insensitive).
    pub fn is_note(&self) -> bool {
        self.extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
    }

    /// Parent folder; `None` for entries at the vault root.
    pub fn parent(&self) -> Option<RelPath> {
        self.0.rfind('/').map(|i| RelPath(self.0[..i].to_string()))
    }

    /// Parent folder as a string; `""` for the vault root.
    pub fn parent_str(&self) -> &str {
        match self.0.rfind('/') {
            Some(i) => &self.0[..i],
            None => "",
        }
    }

    /// Appends a relative path (validated).
    pub fn join(&self, child: &str) -> VaultResult<RelPath> {
        RelPath::new(format!("{}/{}", self.0, child))
    }

    /// `folder/child`, or just `child` when `folder` is `None` (vault root).
    pub fn in_folder(folder: Option<&RelPath>, child: &str) -> VaultResult<RelPath> {
        match folder {
            Some(folder) => folder.join(child),
            None => RelPath::new(child),
        }
    }

    /// The path without a trailing `.md` (for wikilink display).
    pub fn without_md(&self) -> &str {
        if self.is_note() {
            &self.0[..self.0.len() - 3]
        } else {
            &self.0
        }
    }

    /// True if `self` is `ancestor` or lies below it.
    pub fn starts_with(&self, ancestor: &RelPath) -> bool {
        self.0 == ancestor.0
            || (self.0.len() > ancestor.0.len()
                && self.0.starts_with(&ancestor.0)
                && self.0.as_bytes()[ancestor.0.len()] == b'/')
    }

    /// Swaps the `from` prefix for `to`; `None` if `self` isn't under `from`.
    pub fn rebase(&self, from: &RelPath, to: &RelPath) -> Option<RelPath> {
        if self == from {
            return Some(to.clone());
        }
        if !self.starts_with(from) {
            return None;
        }
        Some(RelPath(format!("{}{}", to.0, &self.0[from.0.len()..])))
    }
}

impl fmt::Display for RelPath {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl AsRef<str> for RelPath {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for RelPath {
    type Error = VaultError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        RelPath::new(value)
    }
}

impl TryFrom<&str> for RelPath {
    type Error = VaultError;
    fn try_from(value: &str) -> Result<Self, Self::Error> {
        RelPath::new(value)
    }
}

impl From<RelPath> for String {
    fn from(value: RelPath) -> Self {
        value.0
    }
}

fn validate(path: &str) -> VaultResult<()> {
    let fail = |reason: &str| Err(VaultError::invalid_path(path, reason));
    if path.is_empty() {
        return fail("path is empty");
    }
    if path.len() > MAX_PATH_LEN {
        return fail("path is too long");
    }
    if path.starts_with('/') {
        return Err(VaultError::outside(path));
    }
    if path.contains('\\') {
        return fail("backslashes are not allowed");
    }
    if path.chars().any(|c| c == '\0' || c.is_control()) {
        return fail("control characters are not allowed");
    }
    // `C:foo` / `C:` are drive-relative on Windows.
    let bytes = path.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return Err(VaultError::outside(path));
    }
    for segment in path.split('/') {
        match segment {
            "" => return fail("empty path segment"),
            "." => return fail("'.' segments are not allowed"),
            ".." => return Err(VaultError::outside(path)),
            _ => {}
        }
        if segment.len() > MAX_SEGMENT_LEN {
            return fail("path segment is too long");
        }
        let device = segment.split('.').next().unwrap_or(segment).trim_end();
        if WINDOWS_RESERVED
            .iter()
            .any(|reserved| reserved.eq_ignore_ascii_case(device))
        {
            return fail("reserved device name");
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_normal_paths() {
        for p in [
            "a.md",
            "Projects/Ostralith.md",
            "a b/c d.md",
            ".trash/x.md",
            "日本/メモ.md",
        ] {
            assert!(RelPath::new(p).is_ok(), "{p}");
        }
    }

    #[test]
    fn rejects_traversal_and_junk() {
        for p in [
            "",
            "/etc/passwd",
            "../x",
            "a/../../x",
            "a/..",
            "./a",
            "a//b",
            "a/",
            "a\\b",
            "..\\x",
            "a\0b",
            "C:/x",
            "c:x",
            "con",
            "CON.md",
            "a/lpt1.txt",
            "a\nb",
        ] {
            assert!(RelPath::new(p).is_err(), "{p:?} should be rejected");
        }
        assert!(RelPath::new("x".repeat(256)).is_err());
        assert!(RelPath::new(vec!["a"; 600].join("/")).is_err());
        assert!(matches!(
            RelPath::new("../x"),
            Err(VaultError::PathOutsideVault { .. })
        ));
    }

    #[test]
    fn accessors() {
        let p = RelPath::new("a/b/Note.md").unwrap();
        assert_eq!(p.file_name(), "Note.md");
        assert_eq!(p.file_stem(), "Note");
        assert_eq!(p.extension(), Some("md"));
        assert!(p.is_note());
        assert_eq!(p.parent().unwrap().as_str(), "a/b");
        assert_eq!(p.without_md(), "a/b/Note");
        let root = RelPath::new("x.md").unwrap();
        assert_eq!(root.parent(), None);
        assert_eq!(root.parent_str(), "");
        let a = RelPath::new("a").unwrap();
        assert!(p.starts_with(&a));
        assert!(!RelPath::new("ab/c").unwrap().starts_with(&a));
        let z = RelPath::new("z").unwrap();
        assert_eq!(p.rebase(&a, &z).unwrap().as_str(), "z/b/Note.md");
        assert_eq!(RelPath::new(".hidden").unwrap().extension(), None);
    }

    #[test]
    fn serde_validates() {
        assert!(serde_json::from_str::<RelPath>("\"../x\"").is_err());
        let p: RelPath = serde_json::from_str("\"a/b.md\"").unwrap();
        assert_eq!(serde_json::to_string(&p).unwrap(), "\"a/b.md\"");
    }
}
