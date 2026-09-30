//! Vault lifecycle, the file tree, and note read/write (P1 contract).
//!
//! Every path crossing IPC is vault-relative, `/`-separated, with no leading
//! slash (`Projects/Ostralith.md`). Only [`VaultInfo::path`] and the
//! `vault_create`/`vault_open` arguments are absolute.
//!
//! The commands are thin wrappers over [`VaultRuntime`] and [`OpenVault`]
//! (`crate::vault_runtime`), run through `spawn_blocking`. Anything that
//! needs an open vault fails with `NoVault` when there is none.
//!
//! [`OpenVault`]: crate::vault_runtime::OpenVault

use ostralith_core::CoreError;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::State;

use crate::vault_runtime::{blocking, VaultRuntime};

/// Emitted with an `Option<VaultInfo>` whenever the open vault changes
/// (opened, switched, closed).
pub const VAULT_CURRENT_CHANGED_EVENT: &str = "vault:current-changed";

/// Emitted with a [`FsChangedPayload`] for *external* edits to the open
/// vault (debounced ~250 ms). The app's own writes are not reported.
pub const VAULT_FS_CHANGED_EVENT: &str = "vault:fs-changed";

/// How the per-vault SQLite cache is encrypted at rest.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum DbEncryption {
    /// Plain SQLite.
    None,
    /// SQLCipher with a key held in the OS keychain.
    Keychain,
}

/// A vault in the registry (`$APPDATA/vaults.json`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct VaultInfo {
    /// The uuid from `<vault>/.ostralith/vault.json`.
    pub id: String,
    pub name: String,
    /// Absolute path of the vault folder.
    pub path: String,
    pub encryption: DbEncryption,
    /// Milliseconds since the Unix epoch.
    pub last_opened_at: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum TreeNodeKind {
    Folder,
    /// A `*.md` file.
    Note,
    /// Any other file shown in the tree.
    File,
}

/// One entry of the file tree.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TreeNode {
    /// Vault-relative path.
    pub path: String,
    /// File or folder name, extension included.
    pub name: String,
    pub kind: TreeNodeKind,
    /// Milliseconds since the Unix epoch.
    pub mtime: f64,
    /// Empty unless `kind` is `Folder`. Folders first, then case-insensitive
    /// natural name order.
    pub children: Vec<TreeNode>,
}

/// A note as read from disk.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub path: String,
    /// Display title as derived by the parser; the file stem when the note
    /// has nothing better.
    pub title: String,
    /// The full file content, frontmatter included.
    pub content: String,
    /// Parsed YAML frontmatter, if any.
    pub frontmatter: Option<serde_json::Value>,
    pub mtime: f64,
    /// blake3 hex of `content`; pass it back as `expected_hash` on write.
    pub hash: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct WriteResult {
    pub path: String,
    pub mtime: f64,
    pub hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NoteRef {
    pub path: String,
    pub title: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RenameResult {
    /// The new vault-relative path.
    pub path: String,
    /// Number of `[[links]]` rewritten across the vault.
    pub updated_links: u32,
    /// Number of other notes those links lived in.
    pub updated_files: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Backlink {
    pub source_path: String,
    pub source_title: String,
    /// 0-based line of the link in the source note.
    pub line: u32,
    /// That line, trimmed, at most 300 chars.
    pub context: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Heading {
    /// 1–6.
    pub level: u32,
    pub text: String,
    /// 0-based line.
    pub line: u32,
    pub slug: String,
}

/// What a `[[wikilink]]` target resolves to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LinkTarget {
    /// The target as written (may include `#heading` and `|alias`).
    pub raw: String,
    /// The resolved vault-relative path; for an unresolved link, the path a
    /// new note would be created at.
    pub path: Option<String>,
    pub heading: Option<String>,
    pub exists: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum FsChangeKind {
    Created,
    Modified,
    Removed,
    Renamed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FsChange {
    pub path: String,
    pub kind: FsChangeKind,
    /// Set for `Renamed`.
    pub old_path: Option<String>,
}

/// Payload of [`VAULT_FS_CHANGED_EVENT`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FsChangedPayload {
    pub changes: Vec<FsChange>,
}

/// Registered vaults, most recently opened first.
#[tauri::command]
#[specta::specta]
pub async fn vault_list(runtime: State<'_, VaultRuntime>) -> Result<Vec<VaultInfo>, CoreError> {
    let rt = runtime.inner().clone();
    blocking(move || Ok(rt.list())).await
}

#[tauri::command]
#[specta::specta]
pub async fn vault_current(
    runtime: State<'_, VaultRuntime>,
) -> Result<Option<VaultInfo>, CoreError> {
    Ok(runtime.current_info())
}

/// Creates `parent_dir/name` (`AlreadyExists` if it is non-empty),
/// initialises it as a vault and opens it.
#[tauri::command]
#[specta::specta]
pub async fn vault_create(
    runtime: State<'_, VaultRuntime>,
    parent_dir: String,
    name: String,
    encryption: DbEncryption,
) -> Result<VaultInfo, CoreError> {
    let rt = runtime.inner().clone();
    blocking(move || rt.create(&parent_dir, &name, encryption)).await
}

/// Opens an existing folder as a vault, creating `.ostralith/` if missing,
/// registering it and closing the previous vault.
#[tauri::command]
#[specta::specta]
pub async fn vault_open(
    runtime: State<'_, VaultRuntime>,
    path: String,
) -> Result<VaultInfo, CoreError> {
    let rt = runtime.inner().clone();
    blocking(move || rt.open_path(&path)).await
}

/// `NotFound` if the id is unknown or its folder is gone.
#[tauri::command]
#[specta::specta]
pub async fn vault_open_by_id(
    runtime: State<'_, VaultRuntime>,
    id: String,
) -> Result<VaultInfo, CoreError> {
    let rt = runtime.inner().clone();
    blocking(move || rt.open_by_id(&id)).await
}

#[tauri::command]
#[specta::specta]
pub async fn vault_close(runtime: State<'_, VaultRuntime>) -> Result<(), CoreError> {
    let rt = runtime.inner().clone();
    blocking(move || {
        rt.close();
        Ok(())
    })
    .await
}

/// Removes a vault from the registry. Never deletes files.
#[tauri::command]
#[specta::specta]
pub async fn vault_forget(runtime: State<'_, VaultRuntime>, id: String) -> Result<(), CoreError> {
    let rt = runtime.inner().clone();
    blocking(move || rt.forget(&id)).await
}

/// The root's children. Hides `.ostralith`, `.git`, `.trash` and dotfiles.
#[tauri::command]
#[specta::specta]
pub async fn list_tree(runtime: State<'_, VaultRuntime>) -> Result<Vec<TreeNode>, CoreError> {
    let vault = runtime.current()?;
    blocking(move || vault.list_tree()).await
}

#[tauri::command]
#[specta::specta]
pub async fn read_note(runtime: State<'_, VaultRuntime>, path: String) -> Result<Note, CoreError> {
    let vault = runtime.current()?;
    blocking(move || vault.read_note(&path)).await
}

/// Atomic write. `Conflict` if the file's current hash differs from
/// `expected_hash` (skip the check with `None`).
#[tauri::command]
#[specta::specta]
pub async fn write_note(
    runtime: State<'_, VaultRuntime>,
    path: String,
    content: String,
    expected_hash: Option<String>,
) -> Result<WriteResult, CoreError> {
    let vault = runtime.current()?;
    blocking(move || vault.write_note(&path, &content, expected_hash.as_deref())).await
}

/// Creates `Untitled.md` (then `Untitled 1.md`, ...) in `folder` (the root
/// when `None`), or `<title>.md` with `# <title>\n\n` when a title is given.
#[tauri::command]
#[specta::specta]
pub async fn create_note(
    runtime: State<'_, VaultRuntime>,
    folder: Option<String>,
    title: Option<String>,
) -> Result<NoteRef, CoreError> {
    let vault = runtime.current()?;
    blocking(move || vault.create_note(folder.as_deref(), title.as_deref())).await
}

#[tauri::command]
#[specta::specta]
pub async fn create_folder(
    runtime: State<'_, VaultRuntime>,
    path: String,
) -> Result<(), CoreError> {
    let vault = runtime.current()?;
    blocking(move || vault.create_folder(&path)).await
}

/// Renames a note or folder and rewrites inbound `[[links]]` in other notes.
#[tauri::command]
#[specta::specta]
pub async fn rename_path(
    runtime: State<'_, VaultRuntime>,
    from: String,
    to: String,
) -> Result<RenameResult, CoreError> {
    let vault = runtime.current()?;
    blocking(move || vault.rename_path(&from, &to)).await
}

/// Moves into `<vault>/.trash/` under a unique name. Never hard-deletes.
#[tauri::command]
#[specta::specta]
pub async fn trash_path(runtime: State<'_, VaultRuntime>, path: String) -> Result<(), CoreError> {
    let vault = runtime.current()?;
    blocking(move || vault.trash_path(&path)).await
}

#[tauri::command]
#[specta::specta]
pub async fn get_backlinks(
    runtime: State<'_, VaultRuntime>,
    path: String,
) -> Result<Vec<Backlink>, CoreError> {
    let vault = runtime.current()?;
    blocking(move || vault.backlinks(&path)).await
}

/// Parses the passed (possibly unsaved) text, not the file on disk.
#[tauri::command]
#[specta::specta]
pub async fn get_outline(content: String) -> Result<Vec<Heading>, CoreError> {
    blocking(move || Ok(outline(&content))).await
}

/// Obsidian rules: exact path, then basename (case-insensitive), shortest
/// path wins. `target` may carry `#heading` and `|alias`.
#[tauri::command]
#[specta::specta]
pub async fn resolve_link(
    runtime: State<'_, VaultRuntime>,
    from_path: String,
    target: String,
) -> Result<LinkTarget, CoreError> {
    let vault = runtime.current()?;
    blocking(move || vault.resolve_link(&from_path, &target)).await
}

/// The headings of `content`, in order.
pub fn outline(content: &str) -> Vec<Heading> {
    ostralith_vault::parse_note(content)
        .headings
        .into_iter()
        .map(|h| Heading {
            level: h.level,
            text: h.text,
            line: h.line,
            slug: h.slug,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vault_info_serialises_as_camel_case() {
        let info = VaultInfo {
            id: "v1".into(),
            name: "Notes".into(),
            path: "/Users/me/Notes".into(),
            encryption: DbEncryption::Keychain,
            last_opened_at: 1.0,
        };
        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["lastOpenedAt"], 1.0);
        assert_eq!(json["encryption"], "keychain");
    }

    #[test]
    fn fs_changes_serialise_as_camel_case() {
        let payload = FsChangedPayload {
            changes: vec![FsChange {
                path: "b.md".into(),
                kind: FsChangeKind::Renamed,
                old_path: Some("a.md".into()),
            }],
        };
        assert_eq!(
            serde_json::to_value(&payload).unwrap(),
            serde_json::json!({
                "changes": [{ "path": "b.md", "kind": "renamed", "oldPath": "a.md" }]
            })
        );
    }

    #[test]
    fn tree_nodes_nest_and_note_frontmatter_is_json() {
        let node = TreeNode {
            path: "A".into(),
            name: "A".into(),
            kind: TreeNodeKind::Folder,
            mtime: 0.0,
            children: vec![],
        };
        assert_eq!(serde_json::to_value(&node).unwrap()["kind"], "folder");

        let note = Note {
            path: "a.md".into(),
            title: "A".into(),
            content: String::new(),
            frontmatter: Some(serde_json::json!({ "tags": ["x"] })),
            mtime: 0.0,
            hash: String::new(),
        };
        let json = serde_json::to_value(&note).unwrap();
        assert_eq!(json["frontmatter"]["tags"][0], "x");
    }

    #[test]
    fn outline_lists_headings_with_lines_and_slugs() {
        let headings = outline("---\ntitle: x\n---\n# One\n\n## Two words\n");
        assert_eq!(
            headings,
            vec![
                Heading {
                    level: 1,
                    text: "One".into(),
                    line: 3,
                    slug: "one".into()
                },
                Heading {
                    level: 2,
                    text: "Two words".into(),
                    line: 5,
                    slug: "two-words".into()
                },
            ]
        );
        let from_command = tauri::async_runtime::block_on(get_outline("# One\n".into())).unwrap();
        assert_eq!(from_command[0].text, "One");
    }
}
