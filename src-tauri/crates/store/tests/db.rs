//! Opening, encryption, recovery and rekeying.

mod common;

use std::fs;
use std::path::Path;

use common::{index, link, test_key, Fixture};
use ostralith_core::CoreError;
use ostralith_store::{Connection, Db, Encryption, StoreError};

const SQLITE_MAGIC: &[u8] = b"SQLite format 3\0";

fn header(path: &Path) -> Vec<u8> {
    fs::read(path).unwrap()[..16].to_vec()
}

fn note_paths(db: &Db) -> Vec<String> {
    db.list_all_meta()
        .unwrap()
        .into_iter()
        .map(|m| m.path)
        .collect()
}

fn corrupt_files(dir: &Path) -> Vec<String> {
    let mut names: Vec<_> = fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|n| n.contains(".corrupt-"))
        .collect();
    names.sort();
    names
}

#[test]
fn db_handles_are_send_and_sync() {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<Db>();
}

#[test]
fn plain_databases_are_plain_sqlite() {
    let f = Fixture::plain();
    index(&f.db, "a.md", &[]);
    drop(f.db);
    assert_eq!(header(&f.path), SQLITE_MAGIC);
    let conn = Connection::open(&f.path).unwrap();
    let n: u32 = conn
        .query_row("SELECT count(*) FROM notes", [], |r| r.get(0))
        .unwrap();
    assert_eq!(n, 1);
}

#[test]
fn encrypted_databases_have_no_readable_header() {
    let f = Fixture::encrypted();
    index(&f.db, "secret-title.md", &[]);
    assert!(f.db.is_encrypted());
    drop(f.db);
    let bytes = fs::read(&f.path).unwrap();
    assert_ne!(&bytes[..16], SQLITE_MAGIC);
    let needle = b"secret-title";
    assert!(!bytes.windows(needle.len()).any(|w| w == needle));
}

#[test]
fn encrypted_databases_reopen_with_the_right_key() {
    let f = Fixture::encrypted();
    index(&f.db, "a.md", &[]);
    drop(f.db);
    let db = Db::open(&f.path, f.encryption.clone()).unwrap();
    assert_eq!(note_paths(&db), ["a.md"]);
    assert!(db.integrity_check().unwrap());
}

#[test]
fn encrypted_databases_refuse_to_open_without_a_key() {
    let f = Fixture::encrypted();
    index(&f.db, "a.md", &[]);
    drop(f.db);
    let err = Db::open(&f.path, Encryption::None).unwrap_err();
    assert!(matches!(err, StoreError::WrongKey), "{err:?}");
    assert!(!err.is_corruption());
}

#[test]
fn encrypted_databases_refuse_the_wrong_key() {
    let f = Fixture::encrypted();
    index(&f.db, "a.md", &[]);
    drop(f.db);
    let wrong = test_key(f.dir.path(), "another-vault");
    let err = Db::open(&f.path, wrong).unwrap_err();
    assert!(matches!(err, StoreError::WrongKey), "{err:?}");
}

#[test]
fn plain_databases_refuse_a_key() {
    let f = Fixture::plain();
    drop(f.db);
    let key = test_key(f.dir.path(), "vault");
    let err = Db::open(&f.path, key).unwrap_err();
    assert!(matches!(err, StoreError::NotEncrypted), "{err:?}");
}

#[test]
fn open_or_recover_leaves_a_healthy_database_alone() {
    for encrypted in [false, true] {
        let f = Fixture::new(encrypted);
        index(&f.db, "a.md", &[]);
        drop(f.db);
        let outcome = Db::open_or_recover(&f.path, f.encryption.clone()).unwrap();
        assert!(!outcome.recovered());
        assert_eq!(note_paths(&outcome.db), ["a.md"]);
    }
}

#[test]
fn open_or_recover_replaces_a_garbage_file() {
    for encrypted in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("index.db");
        let garbage = b"this is not a database, just some text ".repeat(200);
        fs::write(&path, &garbage).unwrap();
        let encryption = if encrypted {
            test_key(dir.path(), "v")
        } else {
            Encryption::None
        };

        let err = Db::open(&path, encryption.clone()).unwrap_err();
        assert!(err.is_corruption(), "{err:?}");

        let outcome = Db::open_or_recover(&path, encryption).unwrap();
        let moved = outcome.recovered_from.clone().expect("should recover");
        assert_eq!(fs::read(&moved).unwrap(), garbage);
        let name = moved.file_name().unwrap().to_string_lossy().into_owned();
        assert!(name.starts_with("index.db.corrupt-"), "{name}");
        assert_eq!(corrupt_files(dir.path()), [name]);

        index(&outcome.db, "fresh.md", &[]);
        assert_eq!(note_paths(&outcome.db), ["fresh.md"]);
        assert_eq!(outcome.db.is_encrypted(), encrypted);
    }
}

#[test]
fn open_or_recover_replaces_a_database_with_damaged_pages() {
    let f = Fixture::plain();
    for i in 0..200 {
        index(&f.db, &format!("note-{i}.md"), &[link("x", None, 0)]);
    }
    drop(f.db);
    // Page 1 (the header and schema) stays intact; the pages after it are
    // overwritten, so the file opens but its tables are garbage.
    let mut bytes = fs::read(&f.path).unwrap();
    assert!(bytes.len() > 16 * 1024);
    for b in &mut bytes[4096..16 * 1024] {
        *b = 0x5A;
    }
    fs::write(&f.path, &bytes).unwrap();

    let outcome = Db::open_or_recover(&f.path, Encryption::None).unwrap();
    assert!(outcome.recovered());
    assert!(note_paths(&outcome.db).is_empty());
    assert!(outcome.db.integrity_check().unwrap());
}

#[test]
fn open_or_recover_never_discards_a_database_over_a_key_mismatch() {
    let f = Fixture::encrypted();
    index(&f.db, "a.md", &[]);
    drop(f.db);
    let before = fs::read(&f.path).unwrap();

    let err = Db::open_or_recover(&f.path, Encryption::None).unwrap_err();
    assert!(matches!(err, StoreError::WrongKey), "{err:?}");
    let wrong = test_key(f.dir.path(), "other");
    let err = Db::open_or_recover(&f.path, wrong).unwrap_err();
    assert!(matches!(err, StoreError::WrongKey), "{err:?}");

    assert_eq!(fs::read(&f.path).unwrap(), before);
    assert!(corrupt_files(f.path.parent().unwrap()).is_empty());
    let db = Db::open(&f.path, f.encryption.clone()).unwrap();
    assert_eq!(note_paths(&db), ["a.md"]);
}

#[test]
fn a_schema_from_a_newer_build_is_rebuilt() {
    let f = Fixture::plain();
    index(&f.db, "a.md", &[]);
    drop(f.db);
    Connection::open(&f.path)
        .unwrap()
        .pragma_update(None, "user_version", 999)
        .unwrap();

    let err = Db::open(&f.path, Encryption::None).unwrap_err();
    assert!(matches!(err, StoreError::SchemaTooNew), "{err:?}");
    let outcome = Db::open_or_recover(&f.path, Encryption::None).unwrap();
    assert!(outcome.recovered());
    assert!(note_paths(&outcome.db).is_empty());
}

#[test]
fn rekey_round_trips_plain_to_encrypted_to_plain() {
    let f = Fixture::plain();
    index(&f.db, "a.md", &[]);
    index(&f.db, "b.md", &[link("a", Some("a.md"), 3)]);
    let key = test_key(f.dir.path(), "vault");

    let db = f.db.rekey(key.clone()).unwrap();
    assert!(db.is_encrypted());
    assert_eq!(note_paths(&db), ["a.md", "b.md"]);
    assert_eq!(db.backlinks("a.md").unwrap().len(), 1);
    assert_eq!(
        db.stats().unwrap().schema_version,
        ostralith_store::SCHEMA_VERSION
    );
    drop(db);
    assert_ne!(header(&f.path), SQLITE_MAGIC);
    assert!(matches!(
        Db::open(&f.path, Encryption::None),
        Err(StoreError::WrongKey)
    ));

    let db = Db::open(&f.path, key).unwrap();
    index(&db, "c.md", &[]);
    let db = db.rekey(Encryption::None).unwrap();
    assert!(!db.is_encrypted());
    assert_eq!(note_paths(&db), ["a.md", "b.md", "c.md"]);
    assert!(db.integrity_check().unwrap());
    drop(db);
    assert_eq!(header(&f.path), SQLITE_MAGIC);

    let leftovers: Vec<_> = fs::read_dir(f.path.parent().unwrap())
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|n| n.contains("rekey"))
        .collect();
    assert!(leftovers.is_empty(), "{leftovers:?}");
}

#[test]
fn rekey_can_switch_to_a_new_key() {
    let f = Fixture::encrypted();
    index(&f.db, "a.md", &[]);
    let new_key = test_key(f.dir.path(), "rotated");
    let db = f.db.rekey(new_key.clone()).unwrap();
    drop(db);
    assert!(matches!(
        Db::open(&f.path, f.encryption.clone()),
        Err(StoreError::WrongKey)
    ));
    assert_eq!(note_paths(&Db::open(&f.path, new_key).unwrap()), ["a.md"]);
}

#[test]
fn store_errors_become_core_errors() {
    let err: CoreError = StoreError::WrongKey.into();
    assert!(matches!(err, CoreError::Internal { .. }));
    assert!(err.to_string().contains("key"));
}
