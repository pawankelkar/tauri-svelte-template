use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::error::{VaultError, VaultResult};
use crate::fs::{VaultFs, META_DIR};
use crate::recent::RecentWrites;
use crate::watcher::{FsChange, VaultWatcher};

/// Current `vault.json` format version.
pub const MARKER_VERSION: u32 = 1;
const MARKER_FILE: &str = "vault.json";
const META_GITIGNORE: &str = "cache/\n";

/// `<root>/.ostralith/vault.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VaultMarker {
    pub id: String,
    pub version: u32,
}

/// An opened vault folder: its stable id plus path-safe file access.
#[derive(Debug, Clone)]
pub struct Vault {
    id: String,
    fs: VaultFs,
}

impl Vault {
    /// Makes `root` a vault: creates the folder if needed and writes a new
    /// marker. `AlreadyExists` if it already has one (use [`Vault::open`]).
    pub fn init(root: impl AsRef<Path>) -> VaultResult<Self> {
        let root = root.as_ref();
        let display = root.to_string_lossy().to_string();
        fs::create_dir_all(root).map_err(|e| VaultError::io(&display, "creating vault", e))?;
        let fs = VaultFs::new(root)?;
        let marker_path = fs.root().join(META_DIR).join(MARKER_FILE);
        if marker_path.exists() {
            return Err(VaultError::AlreadyExists {
                path: marker_path.to_string_lossy().into_owned(),
            });
        }
        Self::create_marker(fs)
    }

    /// Opens an existing folder as a vault. A folder without a marker (or
    /// with a corrupt one, which is backed up) is initialised in place.
    pub fn open(root: impl AsRef<Path>) -> VaultResult<Self> {
        let root = root.as_ref();
        let display = root.to_string_lossy().to_string();
        let meta = fs::metadata(root).map_err(|e| VaultError::io(&display, "opening vault", e))?;
        if !meta.is_dir() {
            return Err(VaultError::invalid_input(format!(
                "{display} is not a folder"
            )));
        }
        let fs = VaultFs::new(root)?;
        let meta_dir = fs.root().join(META_DIR);
        let marker_path = meta_dir.join(MARKER_FILE);
        let raw = match fs::read_to_string(&marker_path) {
            Ok(raw) => raw,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Self::create_marker(fs),
            Err(e) => return Err(VaultError::io(&display, "reading vault marker", e)),
        };
        match serde_json::from_str::<VaultMarker>(&raw) {
            Ok(marker) if uuid::Uuid::parse_str(&marker.id).is_ok() => {
                if marker.version > MARKER_VERSION {
                    log::warn!(
                        "vault {display} has marker version {}, newer than {MARKER_VERSION}",
                        marker.version
                    );
                }
                ensure_gitignore(&meta_dir)?;
                Ok(Self { id: marker.id, fs })
            }
            _ => {
                let ts = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                let backup = meta_dir.join(format!("{MARKER_FILE}.corrupt-{ts}"));
                let _ = fs::rename(&marker_path, &backup);
                log::warn!("corrupt vault marker in {display}, backed up to {backup:?}");
                Self::create_marker(fs)
            }
        }
    }

    fn create_marker(fs: VaultFs) -> VaultResult<Self> {
        let meta_dir = fs.root().join(META_DIR);
        fs::create_dir_all(&meta_dir)
            .map_err(|e| VaultError::io(META_DIR, "creating folder", e))?;
        let marker = VaultMarker {
            id: uuid::Uuid::new_v4().to_string(),
            version: MARKER_VERSION,
        };
        let json = serde_json::to_string_pretty(&marker)
            .map_err(|e| VaultError::invalid_input(e.to_string()))?;
        write_file_atomic(&meta_dir.join(MARKER_FILE), json.as_bytes())?;
        ensure_gitignore(&meta_dir)?;
        Ok(Self { id: marker.id, fs })
    }

    /// Stable vault id (uuid v4) from the marker.
    pub fn id(&self) -> &str {
        &self.id
    }

    /// Canonicalised root folder.
    pub fn root(&self) -> &Path {
        self.fs.root()
    }

    /// Display name: the root folder's name.
    pub fn name(&self) -> String {
        self.root()
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default()
    }

    pub fn fs(&self) -> &VaultFs {
        &self.fs
    }

    pub fn recent_writes(&self) -> &RecentWrites {
        self.fs.recent_writes()
    }

    /// Starts a debounced watcher on the root that ignores this vault's own
    /// writes and calls `on_changes` with each batch of external changes.
    pub fn watch<F>(&self, on_changes: F) -> VaultResult<VaultWatcher>
    where
        F: FnMut(Vec<FsChange>) + Send + 'static,
    {
        VaultWatcher::start(self.root(), self.recent_writes().clone(), on_changes)
    }
}

fn ensure_gitignore(meta_dir: &Path) -> VaultResult<()> {
    let path = meta_dir.join(".gitignore");
    if path.exists() {
        return Ok(());
    }
    write_file_atomic(&path, META_GITIGNORE.as_bytes())
}

fn write_file_atomic(path: &Path, bytes: &[u8]) -> VaultResult<()> {
    let display = path.to_string_lossy().to_string();
    let tmp = path.with_extension("tmp");
    let write = || -> std::io::Result<()> {
        use std::io::Write;
        let mut file = fs::File::create(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&tmp, path)
    };
    write().map_err(|e| {
        let _ = fs::remove_file(&tmp);
        VaultError::io(&display, "writing", e)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn init_then_open_keeps_the_id() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("My Vault");
        let vault = Vault::init(&root).unwrap();
        assert!(uuid::Uuid::parse_str(vault.id()).is_ok());
        assert_eq!(vault.name(), "My Vault");
        let marker: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(root.join(".ostralith/vault.json")).unwrap())
                .unwrap();
        assert_eq!(marker["id"], vault.id());
        assert_eq!(marker["version"], 1);
        assert_eq!(
            fs::read_to_string(root.join(".ostralith/.gitignore")).unwrap(),
            "cache/\n"
        );
        assert!(matches!(
            Vault::init(&root),
            Err(VaultError::AlreadyExists { .. })
        ));
        let reopened = Vault::open(&root).unwrap();
        assert_eq!(reopened.id(), vault.id());
        assert_eq!(reopened.root(), fs::canonicalize(&root).unwrap());
    }

    #[test]
    fn open_initialises_plain_folders_and_repairs_corrupt_markers() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("existing.md"), "# hi").unwrap();
        let vault = Vault::open(dir.path()).unwrap();
        assert!(dir.path().join(".ostralith/vault.json").exists());
        assert_eq!(
            fs::read_to_string(dir.path().join("existing.md")).unwrap(),
            "# hi"
        );

        fs::write(dir.path().join(".ostralith/vault.json"), "{ nope").unwrap();
        let repaired = Vault::open(dir.path()).unwrap();
        assert_ne!(repaired.id(), vault.id());

        assert!(matches!(
            Vault::open(dir.path().join("missing")),
            Err(VaultError::NotFound { .. })
        ));
    }
}
