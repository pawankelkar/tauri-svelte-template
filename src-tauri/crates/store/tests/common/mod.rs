//! Shared helpers for the integration tests. Keys come from the file key
//! store in a temp dir, so no test ever touches the real keychain.

#![allow(dead_code)]

use std::path::{Path, PathBuf};

use ostralith_store::key::{self, KeyStore};
use ostralith_store::{Db, Encryption, LinkRecord, NoteRecord};
use tempfile::TempDir;

/// A database in a temp dir, plus the settings to reopen it.
pub struct Fixture {
    pub dir: TempDir,
    pub path: PathBuf,
    pub encryption: Encryption,
    pub db: Db,
}

impl Fixture {
    pub fn plain() -> Self {
        Self::new(false)
    }

    pub fn encrypted() -> Self {
        Self::new(true)
    }

    pub fn new(encrypted: bool) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let encryption = if encrypted {
            test_key(dir.path(), "vault")
        } else {
            Encryption::None
        };
        let path = dir.path().join("vaults/vault/index.db");
        let db = Db::open(&path, encryption.clone()).unwrap();
        Self {
            dir,
            path,
            encryption,
            db,
        }
    }
}

pub fn test_key(dir: &Path, vault_id: &str) -> Encryption {
    let store = KeyStore::File(dir.join("keys"));
    Encryption::Key(key::load_or_create_key(&store, vault_id).unwrap())
}

pub fn note(path: &str) -> NoteRecord {
    let title = path
        .rsplit('/')
        .next()
        .unwrap()
        .trim_end_matches(".md")
        .to_string();
    NoteRecord {
        path: path.to_string(),
        title,
        hash: format!("hash-of-{path}"),
        mtime: 1_700_000_000_000.0,
        size: 42,
        frontmatter: None,
    }
}

pub fn link(target_raw: &str, target_path: Option<&str>, line: u32) -> LinkRecord {
    LinkRecord {
        target_raw: target_raw.to_string(),
        target_path: target_path.map(str::to_string),
        heading: None,
        alias: None,
        is_embed: false,
        line,
        context: format!("see [[{target_raw}]]"),
    }
}

/// Index `path` with only the given links.
pub fn index(db: &Db, path: &str, links: &[LinkRecord]) -> i64 {
    db.index_note(&note(path), links, &[], &[], &[]).unwrap()
}
