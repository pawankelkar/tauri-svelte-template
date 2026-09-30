//! Database keys: 32 random bytes per vault, kept out of the vault folder.
//!
//! Release builds keep them in the OS credential store (the macOS keychain,
//! Windows Credential Manager, the Secret Service on Linux). Debug builds
//! should use [`KeyStore::File`] instead: every unsigned rebuild is a "new"
//! app to the keychain, so a keychain-backed debug build would prompt for
//! access on every launch. [`KeyStore::for_build`] makes that choice.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use zeroize::Zeroizing;

use crate::{Result, StoreError};

/// Keychain service name every vault key is stored under.
pub const KEYCHAIN_SERVICE: &str = "com.ostralith.app";

/// Length of a database key in bytes (SQLCipher's raw AES-256 key).
pub const KEY_LEN: usize = 32;

/// Where database keys live.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KeyStore {
    /// The OS credential store: service [`KEYCHAIN_SERVICE`], account
    /// `vault-db:<vault id>`.
    Keychain,
    /// Plain files `<dir>/vault-db-<vault id>.key` (mode 0600 on Unix).
    /// For debug builds and tests only: the key sits next to the app data.
    File(PathBuf),
}

impl KeyStore {
    /// [`KeyStore::File`] in `dev_dir` for debug builds, the keychain for
    /// release builds.
    pub fn for_build(dev_dir: impl Into<PathBuf>) -> Self {
        if cfg!(debug_assertions) {
            Self::File(dev_dir.into())
        } else {
            Self::Keychain
        }
    }
}

/// The key for `vault_id`, creating and storing a fresh random one if there
/// is none yet.
pub fn load_or_create_key(store: &KeyStore, vault_id: &str) -> Result<Zeroizing<Vec<u8>>> {
    if let Some(key) = load_key(store, vault_id)? {
        return Ok(key);
    }
    let key = generate_key()?;
    save_key(store, vault_id, &key)?;
    Ok(key)
}

/// The stored key for `vault_id`, or `None` if there is none.
pub fn load_key(store: &KeyStore, vault_id: &str) -> Result<Option<Zeroizing<Vec<u8>>>> {
    check_vault_id(vault_id)?;
    let key = match store {
        KeyStore::Keychain => match keychain_entry(vault_id)?.get_secret() {
            Ok(secret) => Some(Zeroizing::new(secret)),
            Err(keyring::Error::NoEntry) => None,
            Err(err) => return Err(keychain_error(err)),
        },
        KeyStore::File(dir) => {
            let path = key_file(dir, vault_id);
            match fs::read(&path) {
                Ok(bytes) => Some(Zeroizing::new(bytes)),
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => None,
                Err(err) => return Err(StoreError::io(path, err)),
            }
        }
    };
    match key {
        Some(key) if key.len() != KEY_LEN => Err(StoreError::key(format!(
            "the stored key for vault {vault_id} is {} bytes, expected {KEY_LEN}",
            key.len()
        ))),
        key => Ok(key),
    }
}

/// Store `key` for `vault_id`, replacing any existing one.
pub fn save_key(store: &KeyStore, vault_id: &str, key: &[u8]) -> Result<()> {
    check_vault_id(vault_id)?;
    if key.len() != KEY_LEN {
        return Err(StoreError::key(format!(
            "a database key must be {KEY_LEN} bytes"
        )));
    }
    match store {
        KeyStore::Keychain => keychain_entry(vault_id)?
            .set_secret(key)
            .map_err(keychain_error),
        KeyStore::File(dir) => write_key_file(dir, vault_id, key),
    }
}

/// Forget the key for `vault_id`. Not an error if there is none. Once the
/// key is gone its encrypted database can only be rebuilt, not opened.
pub fn delete_key(store: &KeyStore, vault_id: &str) -> Result<()> {
    check_vault_id(vault_id)?;
    match store {
        KeyStore::Keychain => match keychain_entry(vault_id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(keychain_error(err)),
        },
        KeyStore::File(dir) => {
            let path = key_file(dir, vault_id);
            match fs::remove_file(&path) {
                Ok(()) => Ok(()),
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(err) => Err(StoreError::io(path, err)),
            }
        }
    }
}

/// 32 bytes from the OS CSPRNG.
pub fn generate_key() -> Result<Zeroizing<Vec<u8>>> {
    let mut key = Zeroizing::new(vec![0u8; KEY_LEN]);
    getrandom::fill(&mut key)
        .map_err(|err| StoreError::key(format!("no randomness available: {err}")))?;
    Ok(key)
}

fn keychain_entry(vault_id: &str) -> Result<keyring::Entry> {
    keyring::Entry::new(KEYCHAIN_SERVICE, &format!("vault-db:{vault_id}")).map_err(keychain_error)
}

fn keychain_error(err: keyring::Error) -> StoreError {
    StoreError::key(format!("keychain: {err}"))
}

fn key_file(dir: &Path, vault_id: &str) -> PathBuf {
    dir.join(format!("vault-db-{vault_id}.key"))
}

/// Vault ids are UUIDs; anything else is refused so an id can never escape
/// the key directory or collide with another account name.
fn check_vault_id(vault_id: &str) -> Result<()> {
    let ok = !vault_id.is_empty()
        && vault_id.len() <= 128
        && vault_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    if ok {
        Ok(())
    } else {
        Err(StoreError::key(format!("invalid vault id {vault_id:?}")))
    }
}

/// Write via a temp file and rename, so a crash never leaves a truncated key.
fn write_key_file(dir: &Path, vault_id: &str, key: &[u8]) -> Result<()> {
    fs::create_dir_all(dir).map_err(|err| StoreError::io(dir, err))?;
    let path = key_file(dir, vault_id);
    let tmp = dir.join(format!("vault-db-{vault_id}.key.tmp"));
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let result = options
        .open(&tmp)
        .and_then(|mut file| {
            file.write_all(key)?;
            file.sync_all()
        })
        .and_then(|()| fs::rename(&tmp, &path));
    if let Err(err) = result {
        let _ = fs::remove_file(&tmp);
        return Err(StoreError::io(path, err));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_store_creates_once_then_loads_the_same_key() {
        let dir = tempfile::tempdir().unwrap();
        let store = KeyStore::File(dir.path().join("keys"));
        let first = load_or_create_key(&store, "vault-1").unwrap();
        assert_eq!(first.len(), KEY_LEN);
        let second = load_or_create_key(&store, "vault-1").unwrap();
        assert_eq!(*first, *second);
        let other = load_or_create_key(&store, "vault-2").unwrap();
        assert_ne!(*first, *other);
    }

    #[cfg(unix)]
    #[test]
    fn key_files_are_private() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let store = KeyStore::File(dir.path().to_path_buf());
        load_or_create_key(&store, "v").unwrap();
        let mode = fs::metadata(dir.path().join("vault-db-v.key"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    #[test]
    fn delete_forgets_the_key_and_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let store = KeyStore::File(dir.path().to_path_buf());
        let first = load_or_create_key(&store, "v").unwrap();
        delete_key(&store, "v").unwrap();
        assert!(load_key(&store, "v").unwrap().is_none());
        delete_key(&store, "v").unwrap();
        let second = load_or_create_key(&store, "v").unwrap();
        assert_ne!(*first, *second);
    }

    #[test]
    fn rejects_ids_that_could_escape_the_directory() {
        let dir = tempfile::tempdir().unwrap();
        let store = KeyStore::File(dir.path().to_path_buf());
        for id in ["", "../x", "a/b", "a b", "a.key"] {
            assert!(
                matches!(load_or_create_key(&store, id), Err(StoreError::Key { .. })),
                "{id:?} should be rejected"
            );
        }
    }

    #[test]
    fn rejects_a_truncated_key_file() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("vault-db-v.key"), b"short").unwrap();
        let store = KeyStore::File(dir.path().to_path_buf());
        assert!(matches!(load_key(&store, "v"), Err(StoreError::Key { .. })));
    }

    #[test]
    fn debug_builds_pick_the_file_store() {
        let store = KeyStore::for_build("/tmp/keys");
        if cfg!(debug_assertions) {
            assert_eq!(store, KeyStore::File("/tmp/keys".into()));
        } else {
            assert_eq!(store, KeyStore::Keychain);
        }
    }
}
