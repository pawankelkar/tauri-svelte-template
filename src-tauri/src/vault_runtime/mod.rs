//! The open vault and everything it owns: the vault registry, the per-vault
//! SQLite cache and search index, the file watcher, the background indexer
//! and the git backup.
//!
//! The command modules (`commands::{vault,search,db,backup}`) are thin
//! wrappers: they clone the managed [`VaultRuntime`] and run one of its
//! blocking methods through `spawn_blocking`. Nothing here depends on a
//! Tauri runtime except [`TauriSink`], so the whole lifecycle is tested
//! with a plain temp dir and a recording [`EventSink`].
//!
//! Threading model:
//! - [`VaultRuntime`] is `Clone` (an `Arc`). `open_lock` serialises
//!   open/create/close; `current` is read by every command.
//! - [`OpenVault`] is shared as `Arc`. Its `index_lock` serialises every
//!   mutation of the DB + search index (commands hold it for a whole
//!   operation, the background worker per note), so the cache never sees
//!   two writers for the same note.
//! - One worker thread per open vault runs the initial sync, full
//!   rebuilds, link re-resolution and external file changes, in order. It
//!   only holds a `Weak` between jobs, so dropping the vault ends it.
//! - See `docs/developer/vault-and-index.md` for the full picture.

mod backup;
mod convert;
mod open_vault;
mod registry;
mod worker;

#[cfg(test)]
mod tests;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

use ostralith_core::CoreError;
use ostralith_store::key::KeyStore;
use ostralith_vault::Vault;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::commands::json_store::validate_filename;
use crate::commands::search::{IndexStatus, INDEX_STATUS_EVENT};
use crate::commands::vault::{
    DbEncryption, FsChangedPayload, VaultInfo, VAULT_CURRENT_CHANGED_EVENT, VAULT_FS_CHANGED_EVENT,
};

pub use open_vault::OpenVault;
use registry::Registry;

/// Where the runtime reports what happened. The app forwards to Tauri
/// events; tests record.
pub trait EventSink: Send + Sync + 'static {
    /// [`VAULT_CURRENT_CHANGED_EVENT`].
    fn current_changed(&self, info: Option<&VaultInfo>);
    /// [`VAULT_FS_CHANGED_EVENT`] (external changes only).
    fn fs_changed(&self, payload: &FsChangedPayload);
    /// [`INDEX_STATUS_EVENT`].
    fn index_status(&self, status: IndexStatus);
}

/// Emits the runtime's events to every webview.
pub struct TauriSink<R: Runtime>(AppHandle<R>);

impl<R: Runtime> EventSink for TauriSink<R> {
    fn current_changed(&self, info: Option<&VaultInfo>) {
        if let Err(e) = self.0.emit(VAULT_CURRENT_CHANGED_EVENT, info) {
            log::warn!("Could not emit {VAULT_CURRENT_CHANGED_EVENT}: {e}");
        }
    }

    fn fs_changed(&self, payload: &FsChangedPayload) {
        if let Err(e) = self.0.emit(VAULT_FS_CHANGED_EVENT, payload) {
            log::warn!("Could not emit {VAULT_FS_CHANGED_EVENT}: {e}");
        }
    }

    fn index_status(&self, status: IndexStatus) {
        if let Err(e) = self.0.emit(INDEX_STATUS_EVENT, status) {
            log::warn!("Could not emit {INDEX_STATUS_EVENT}: {e}");
        }
    }
}

/// The vault registry plus the currently open vault. Managed Tauri state.
#[derive(Clone)]
pub struct VaultRuntime {
    inner: Arc<Inner>,
}

struct Inner {
    /// `$APPDATA`: holds `vaults.json`, `vaults/<id>/` and `dev-keys/`.
    data_dir: PathBuf,
    key_store: KeyStore,
    sink: Arc<dyn EventSink>,
    current: RwLock<Option<Arc<OpenVault>>>,
    /// Serialises open / create / close / forget.
    open_lock: Mutex<()>,
    /// Serialises read-modify-write of `vaults.json`.
    registry_lock: Mutex<()>,
}

/// Registry file in the app data dir.
pub const REGISTRY_FILE: &str = "vaults.json";

impl VaultRuntime {
    pub fn new(
        data_dir: impl Into<PathBuf>,
        key_store: KeyStore,
        sink: Arc<dyn EventSink>,
    ) -> Self {
        Self {
            inner: Arc::new(Inner {
                data_dir: data_dir.into(),
                key_store,
                sink,
                current: RwLock::new(None),
                open_lock: Mutex::new(()),
                registry_lock: Mutex::new(()),
            }),
        }
    }

    /// Builds the runtime on `$APPDATA` and manages it. Never opens a vault:
    /// the frontend calls `vault_open_by_id` with its last vault id.
    pub fn init<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("Resolving app data dir: {e}"))?;
        let key_store = KeyStore::for_build(data_dir.join("dev-keys"));
        if let KeyStore::File(dir) = &key_store {
            log::info!("Debug build: vault DB keys are files in {}", dir.display());
        }
        let runtime = Self::new(data_dir, key_store, Arc::new(TauriSink(app.clone())));
        app.manage(runtime);
        Ok(())
    }

    /// `$APPDATA/vaults/<id>/`: the vault's DB and search index.
    pub fn vault_data_dir(&self, id: &str) -> PathBuf {
        self.inner.data_dir.join("vaults").join(id)
    }

    // --- Registry ---------------------------------------------------------

    fn registry_path(&self) -> PathBuf {
        self.inner.data_dir.join(REGISTRY_FILE)
    }

    fn registry(&self) -> (MutexGuard<'_, ()>, Registry) {
        let guard = lock(&self.inner.registry_lock);
        (guard, Registry::load(&self.registry_path()))
    }

    /// Registered vaults, most recently opened first. Entries whose folder
    /// is gone are kept (an unplugged drive comes back).
    pub fn list(&self) -> Vec<VaultInfo> {
        self.registry().1.sorted()
    }

    /// Removes a vault from the registry (closing it if it is open). Never
    /// deletes the vault, its cache or its key. Unknown ids are a no-op.
    pub fn forget(&self, id: &str) -> Result<(), CoreError> {
        let _open = lock(&self.inner.open_lock);
        if self.current_info().is_some_and(|info| info.id == id) {
            self.close_locked(true);
        }
        let (_guard, mut registry) = self.registry();
        if registry.remove(id) {
            registry.save(&self.inner.data_dir, &self.registry_path())?;
        }
        Ok(())
    }

    fn register(&self, info: &VaultInfo) -> Result<(), CoreError> {
        let (_guard, mut registry) = self.registry();
        registry.upsert(info.clone());
        registry.save(&self.inner.data_dir, &self.registry_path())
    }

    // --- Current vault ----------------------------------------------------

    pub fn current_info(&self) -> Option<VaultInfo> {
        read(&self.inner.current).as_ref().map(|v| v.info().clone())
    }

    /// The open vault, or `NoVault`.
    pub fn current(&self) -> Result<Arc<OpenVault>, CoreError> {
        read(&self.inner.current).clone().ok_or(CoreError::NoVault)
    }

    /// The open vault, if any.
    pub fn try_current(&self) -> Option<Arc<OpenVault>> {
        read(&self.inner.current).clone()
    }

    /// Creates `parent_dir/name`, initialises it as a vault and opens it.
    pub fn create(
        &self,
        parent_dir: &str,
        name: &str,
        encryption: DbEncryption,
    ) -> Result<VaultInfo, CoreError> {
        let name = name.trim();
        validate_filename(name, 255).map_err(CoreError::invalid_input)?;
        let parent = Path::new(parent_dir);
        if !parent.is_absolute() {
            return Err(CoreError::invalid_input(format!(
                "{parent_dir} is not an absolute path"
            )));
        }
        if !parent.is_dir() {
            return Err(CoreError::not_found(parent_dir));
        }
        let dir = parent.join(name);
        if dir.exists() {
            let empty = dir.is_dir()
                && fs::read_dir(&dir)
                    .map(|mut entries| entries.next().is_none())
                    .unwrap_or(false);
            if !empty {
                return Err(CoreError::already_exists(dir.display().to_string()));
            }
        }
        fs::create_dir_all(&dir)
            .map_err(|e| CoreError::from(format!("Creating {}: {e}", dir.display())))?;
        let vault = Vault::init(&dir)?;
        let _open = lock(&self.inner.open_lock);
        self.open_locked(vault, encryption)
    }

    /// Opens an existing folder (creating `.ostralith/` if missing).
    pub fn open_path(&self, path: &str) -> Result<VaultInfo, CoreError> {
        let root = Path::new(path);
        if !root.is_absolute() {
            return Err(CoreError::invalid_input(format!(
                "{path} is not an absolute path"
            )));
        }
        if !root.is_dir() {
            return Err(CoreError::not_found(path));
        }
        let _open = lock(&self.inner.open_lock);
        let vault = Vault::open(root)?;
        let registry = self.registry().1;
        let encryption = match registry.find(vault.id()) {
            Some(entry) => entry.encryption,
            None => registry::detect_encryption(
                &self
                    .vault_data_dir(&safe_id(vault.id())?)
                    .join(open_vault::DB_FILE),
            ),
        };
        self.open_locked(vault, encryption)
    }

    /// Opens a registered vault. `NotFound` if the id is unknown or its
    /// folder is gone (the entry is kept).
    pub fn open_by_id(&self, id: &str) -> Result<VaultInfo, CoreError> {
        let _open = lock(&self.inner.open_lock);
        let entry = self
            .registry()
            .1
            .find(id)
            .cloned()
            .ok_or_else(|| CoreError::not_found(format!("vault {id}")))?;
        let root = Path::new(&entry.path);
        if !root.is_dir() {
            return Err(CoreError::not_found(entry.path));
        }
        let vault = Vault::open(root)?;
        if vault.id() != entry.id {
            log::warn!(
                "{} now has vault id {} (registered as {}); re-registering",
                entry.path,
                vault.id(),
                entry.id
            );
        }
        self.open_locked(vault, entry.encryption)
    }

    fn open_locked(&self, vault: Vault, encryption: DbEncryption) -> Result<VaultInfo, CoreError> {
        let id = safe_id(vault.id())?;
        // Close first: reopening the same vault needs the search index's
        // writer lock the previous instance holds.
        self.close_locked(false);
        let opened = OpenVault::open(
            vault,
            encryption,
            &self.vault_data_dir(&id),
            &self.inner.key_store,
            self.inner.sink.clone(),
        );
        let opened = match opened {
            Ok(opened) => opened,
            Err(e) => {
                self.inner.sink.current_changed(None);
                return Err(e);
            }
        };
        let info = opened.info().clone();
        if let Err(e) = self.register(&info) {
            log::warn!("Could not save the vault registry: {e}");
        }
        *write(&self.inner.current) = Some(opened);
        log::info!("Opened vault {} at {}", info.id, info.path);
        self.inner.sink.current_changed(Some(&info));
        Ok(info)
    }

    /// Closes the open vault (no-op if none).
    pub fn close(&self) {
        let _open = lock(&self.inner.open_lock);
        self.close_locked(true);
    }

    /// On app exit: stop the watcher and worker and commit the index,
    /// without emitting (the webview may already be gone).
    pub fn shutdown(&self) {
        let _open = lock(&self.inner.open_lock);
        let taken = write(&self.inner.current).take();
        if let Some(vault) = taken {
            vault.shutdown();
        }
    }

    fn close_locked(&self, emit: bool) {
        let taken = write(&self.inner.current).take();
        if let Some(vault) = taken {
            log::info!("Closing vault {}", vault.info().id);
            vault.shutdown();
            drop(vault);
            if emit {
                self.inner.sink.current_changed(None);
            }
        }
    }
}

/// Vault ids name directories and keychain accounts, so only accept what
/// `Vault::init` generates (uuids) and similar tame strings.
fn safe_id(id: &str) -> Result<String, CoreError> {
    let ok = !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if ok {
        Ok(id.to_string())
    } else {
        Err(CoreError::invalid_input(format!(
            "unsupported vault id {id:?} in .ostralith/vault.json"
        )))
    }
}

pub(crate) fn now_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

pub(crate) fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

fn read<T>(lock: &RwLock<T>) -> std::sync::RwLockReadGuard<'_, T> {
    lock.read().unwrap_or_else(|e| e.into_inner())
}

fn write<T>(lock: &RwLock<T>) -> std::sync::RwLockWriteGuard<'_, T> {
    lock.write().unwrap_or_else(|e| e.into_inner())
}

/// Runs blocking vault work off the async runtime.
pub async fn blocking<T, F>(f: F) -> Result<T, CoreError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, CoreError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| CoreError::from(format!("background task failed: {e}")))?
}
