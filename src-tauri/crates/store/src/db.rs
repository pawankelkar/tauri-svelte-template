use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use rusqlite::{Connection, OpenFlags, Transaction, TransactionBehavior};
use zeroize::Zeroizing;

use crate::error::is_corrupt_code;
use crate::records::{
    BacklinkRow, DbStats, HeadingRecord, LinkRecord, NoteMeta, NoteRecord, TaskRecord,
};
use crate::repo::{headings, links, notes, tags, tasks};
use crate::{migrations, Result, StoreError};

/// Read connections kept open next to the single writer.
const READERS: usize = 3;

/// How long a statement waits on a lock before failing with `SQLITE_BUSY`.
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);

/// The first 16 bytes of every plain SQLite file.
const SQLITE_MAGIC: &[u8; 16] = b"SQLite format 3\0";

/// How the database file is (to be) encrypted.
#[derive(Clone, Default)]
pub enum Encryption {
    /// A plain SQLite file.
    #[default]
    None,
    /// SQLCipher with this raw 32-byte key (no passphrase derivation, so
    /// opening is instant). See [`crate::key`] for where keys come from.
    Key(Zeroizing<Vec<u8>>),
}

impl Encryption {
    pub fn is_encrypted(&self) -> bool {
        matches!(self, Self::Key(_))
    }

    /// The key as SQLCipher's raw-key literal, `x'<hex>'`, or `""` for none.
    fn literal(&self) -> Zeroizing<String> {
        match self {
            Self::None => Zeroizing::new(String::new()),
            Self::Key(key) => {
                let hex = Zeroizing::new(hex::encode(key.as_slice()));
                Zeroizing::new(format!("x'{}'", hex.as_str()))
            }
        }
    }
}

impl fmt::Debug for Encryption {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::None => f.write_str("None"),
            Self::Key(_) => f.write_str("Key(<redacted>)"),
        }
    }
}

/// What [`Db::open_or_recover`] did.
#[derive(Debug)]
pub struct OpenOutcome {
    pub db: Db,
    /// Where the unusable file was moved, if it had to be replaced. When
    /// this is `Some` the database is empty and the vault must be reindexed.
    pub recovered_from: Option<PathBuf>,
}

impl OpenOutcome {
    pub fn recovered(&self) -> bool {
        self.recovered_from.is_some()
    }
}

/// A per-vault index database: one writer connection behind a mutex plus a
/// few read connections, all in WAL mode so reads never wait for a write.
///
/// Every method blocks; async callers should use `spawn_blocking`.
pub struct Db {
    path: PathBuf,
    encryption: Encryption,
    writer: Mutex<Connection>,
    readers: Vec<Mutex<Connection>>,
    next_reader: AtomicUsize,
}

impl fmt::Debug for Db {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Db")
            .field("path", &self.path)
            .field("encrypted", &self.encryption.is_encrypted())
            .finish_non_exhaustive()
    }
}

impl Db {
    /// Open (creating if missing) the database at `path` and bring its
    /// schema up to date.
    ///
    /// Fails with [`StoreError::WrongKey`] if the file is encrypted and
    /// `encryption` is `None` or a different key, [`StoreError::NotEncrypted`]
    /// if a key is given for a plain file, and [`StoreError::Corrupt`] if the
    /// file isn't a database at all.
    pub fn open(path: impl AsRef<Path>, encryption: Encryption) -> Result<Self> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
            fs::create_dir_all(parent).map_err(|err| StoreError::io(parent, err))?;
        }

        let mut writer = open_connection(&path, &encryption)?;
        run(&writer, "PRAGMA journal_mode = WAL")?;
        writer.pragma_update(None, "synchronous", "NORMAL")?;
        migrations::MIGRATIONS.to_latest(&mut writer)?;

        let readers = (0..READERS)
            .map(|_| {
                let conn = open_connection(&path, &encryption)?;
                conn.pragma_update(None, "query_only", true)?;
                Ok(Mutex::new(conn))
            })
            .collect::<Result<_>>()?;

        Ok(Self {
            path,
            encryption,
            writer: Mutex::new(writer),
            readers,
            next_reader: AtomicUsize::new(0),
        })
    }

    /// [`Db::open`], but a corrupt file (or one that fails
    /// [`integrity_check`](Self::integrity_check), or has a schema from a
    /// newer build) is moved aside to `<name>.corrupt-<unix ms>` and replaced
    /// with a fresh database. Key mismatches are returned as errors, never
    /// "recovered": the file is fine, the key is wrong.
    pub fn open_or_recover(path: impl AsRef<Path>, encryption: Encryption) -> Result<OpenOutcome> {
        let path = path.as_ref();
        match Self::open(path, encryption.clone()) {
            Ok(db) => match db.integrity_check() {
                Ok(true) => {
                    return Ok(OpenOutcome {
                        db,
                        recovered_from: None,
                    })
                }
                Ok(false) => log::warn!("{} failed its integrity check", path.display()),
                Err(err) if err.is_corruption() => {
                    log::warn!("{} is corrupt: {err}", path.display());
                }
                Err(err) => return Err(err),
            },
            Err(err) if err.is_corruption() => {
                log::warn!("{} could not be opened: {err}", path.display());
            }
            Err(err) => return Err(err),
        }

        let moved = quarantine(path)?;
        log::warn!("moved the unusable index to {}", moved.display());
        let db = Self::open(path, encryption)?;
        Ok(OpenOutcome {
            db,
            recovered_from: Some(moved),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn is_encrypted(&self) -> bool {
        self.encryption.is_encrypted()
    }

    /// Run `f` on a read connection. Writes from inside `f` fail
    /// (`query_only`); use [`Db::write`] for those.
    pub fn read<T>(&self, f: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
        let conn = self.reader();
        f(&conn)
    }

    /// Run `f` in an immediate transaction on the writer connection,
    /// committing if it returns `Ok` and rolling back otherwise.
    pub fn write<T>(&self, f: impl FnOnce(&Transaction<'_>) -> Result<T>) -> Result<T> {
        let mut conn = lock(&self.writer);
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let out = f(&tx)?;
        tx.commit()?;
        Ok(out)
    }

    /// `PRAGMA integrity_check` came back clean.
    pub fn integrity_check(&self) -> Result<bool> {
        self.read(|conn| {
            let mut stmt = conn.prepare("PRAGMA integrity_check")?;
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(rows.len() == 1 && rows[0] == "ok")
        })
    }

    pub fn stats(&self) -> Result<DbStats> {
        let (schema_version, note_count) = self.read(|conn| {
            let version: u32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
            Ok((version, notes::count(conn)?))
        })?;
        let size_bytes = [self.path.clone(), sidecar(&self.path, "-wal")]
            .iter()
            .filter_map(|p| fs::metadata(p).ok())
            .map(|m| m.len())
            .sum();
        Ok(DbStats {
            schema_version,
            note_count,
            size_bytes,
        })
    }

    /// Write one note and everything parsed out of it in a single
    /// transaction, replacing whatever was stored for that path. Returns the
    /// note's id.
    pub fn index_note(
        &self,
        note: &NoteRecord,
        note_links: &[LinkRecord],
        note_tags: &[String],
        note_headings: &[HeadingRecord],
        note_tasks: &[TaskRecord],
    ) -> Result<i64> {
        self.write(|tx| {
            let id = notes::upsert(tx, note)?;
            links::replace_for_note(tx, id, note_links)?;
            tags::replace_for_note(tx, id, note_tags)?;
            headings::replace_for_note(tx, id, note_headings)?;
            tasks::replace_for_note(tx, id, note_tasks)?;
            Ok(id)
        })
    }

    /// Drop a note from the index and mark links to it unresolved. Returns
    /// whether it was indexed.
    pub fn remove_note(&self, path: &str) -> Result<bool> {
        self.write(|tx| {
            let existed = notes::delete_by_path(tx, path)?;
            links::unresolve_target(tx, path)?;
            Ok(existed)
        })
    }

    /// Drop every note under `folder` and mark links into it unresolved.
    /// Returns how many notes were removed.
    pub fn remove_folder(&self, folder: &str) -> Result<usize> {
        self.write(|tx| {
            let n = notes::delete_prefix(tx, folder)?;
            links::unresolve_prefix(tx, folder)?;
            Ok(n)
        })
    }

    /// Move a note and repoint resolved links to it. Returns whether it was
    /// indexed.
    pub fn rename_note(&self, old: &str, new: &str) -> Result<bool> {
        self.write(|tx| {
            let existed = notes::rename_path(tx, old, new)?;
            links::retarget(tx, old, new)?;
            Ok(existed)
        })
    }

    /// Move every note under folder `old` to `new` and repoint resolved
    /// links into it. Returns how many notes moved.
    pub fn rename_folder(&self, old: &str, new: &str) -> Result<usize> {
        self.write(|tx| {
            let n = notes::rename_prefix(tx, old, new)?;
            links::retarget_prefix(tx, old, new)?;
            Ok(n)
        })
    }

    pub fn backlinks(&self, target_path: &str) -> Result<Vec<BacklinkRow>> {
        self.read(|conn| links::backlinks(conn, target_path))
    }

    pub fn list_all_meta(&self) -> Result<Vec<NoteMeta>> {
        self.read(notes::list_all_meta)
    }

    /// Empty every table (keeping the schema), e.g. before a full reindex.
    pub fn clear(&self) -> Result<()> {
        self.write(|tx| {
            notes::delete_all(tx)?;
            crate::repo::meta::delete_all(tx)?;
            Ok(())
        })
    }

    /// Re-encrypt the database: plain to encrypted, encrypted to plain, or
    /// to a different key. The data is exported with `sqlcipher_export` into
    /// a temporary file which then atomically replaces the original, and the
    /// database is reopened with `encryption`.
    ///
    /// Consumes the handle because every connection has to close before the
    /// swap. If this fails the original file is left untouched; reopen it
    /// with the old encryption.
    pub fn rekey(self, encryption: Encryption) -> Result<Db> {
        let tmp = sidecar(&self.path, ".rekey-tmp");
        remove_if_exists(&tmp)?;
        if let Err(err) = self.export_to(&tmp, &encryption) {
            let _ = remove_if_exists(&tmp);
            return Err(err);
        }

        let path = self.path.clone();
        drop(self);
        for suffix in ["-wal", "-shm"] {
            remove_if_exists(&sidecar(&path, suffix))?;
        }
        fs::rename(&tmp, &path).map_err(|err| StoreError::io(&path, err))?;
        Db::open(&path, encryption)
    }

    fn export_to(&self, tmp: &Path, encryption: &Encryption) -> Result<()> {
        let conn = lock(&self.writer);
        run(&conn, "PRAGMA wal_checkpoint(TRUNCATE)")?;
        let tmp_str = tmp
            .to_str()
            .ok_or_else(|| StoreError::key(format!("{} is not valid UTF-8", tmp.display())))?;
        conn.execute(
            "ATTACH DATABASE ?1 AS rekeyed KEY ?2",
            [tmp_str, encryption.literal().as_str()],
        )?;
        let result = (|| -> Result<()> {
            run(&conn, "PRAGMA rekeyed.journal_mode = DELETE")?;
            run(&conn, "SELECT sqlcipher_export('rekeyed')")?;
            let version: u32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
            conn.pragma_update(Some("rekeyed"), "user_version", version)?;
            Ok(())
        })();
        conn.execute("DETACH DATABASE rekeyed", [])?;
        result
    }

    /// A free read connection, or (if all are busy) the next one in turn.
    fn reader(&self) -> MutexGuard<'_, Connection> {
        for conn in &self.readers {
            if let Ok(guard) = conn.try_lock() {
                return guard;
            }
        }
        let i = self.next_reader.fetch_add(1, Ordering::Relaxed) % self.readers.len();
        lock(&self.readers[i])
    }
}

/// Execute one statement, discarding any rows it returns (many pragmas
/// report their new value).
fn run(conn: &Connection, sql: &str) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare(sql)?;
    let mut rows = stmt.query([])?;
    while rows.next()?.is_some() {}
    Ok(())
}

fn lock(conn: &Mutex<Connection>) -> MutexGuard<'_, Connection> {
    // A panic mid-query leaves the connection itself usable (an open
    // transaction is rolled back when the guard's Transaction drops).
    conn.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Open one connection, apply the key and per-connection settings, and
/// check the key actually decrypts the file.
fn open_connection(path: &Path, encryption: &Encryption) -> Result<Connection> {
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_CREATE
            | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    if encryption.is_encrypted() {
        // Must be the first statement on the connection. Built by hand so
        // the only copy of the SQL holding the key is zeroized on drop.
        let sql = Zeroizing::new(format!(
            "PRAGMA key = \"{}\"",
            encryption.literal().as_str()
        ));
        run(&conn, &sql)?;
        run(&conn, "PRAGMA cipher_memory_security = ON")?;
    }
    // The first read of page 1 is what fails on a wrong key or a garbage file.
    if let Err(err) = conn.query_row("SELECT count(*) FROM sqlite_master", [], |_| Ok(())) {
        return Err(classify_open_error(path, encryption, err));
    }
    conn.busy_timeout(BUSY_TIMEOUT)?;
    conn.pragma_update(None, "foreign_keys", true)?;
    Ok(conn)
}

/// SQLite reports a wrong key, a missing key and a garbage file all as
/// `SQLITE_NOTADB`; tell them apart by looking at the file.
fn classify_open_error(path: &Path, encryption: &Encryption, err: rusqlite::Error) -> StoreError {
    if !is_corrupt_code(&err) {
        return err.into();
    }
    let head = read_head(path);
    let plain = head.starts_with(SQLITE_MAGIC);
    match (encryption.is_encrypted(), plain) {
        (true, true) => StoreError::NotEncrypted,
        (false, true) => StoreError::Corrupt {
            message: err.to_string(),
        },
        // No SQLite header: either SQLCipher output or damage. Encrypted
        // pages are indistinguishable from random bytes; zeroed or text
        // garbage is not.
        (_, false) if looks_random(&head) => StoreError::WrongKey,
        (_, false) => StoreError::Corrupt {
            message: err.to_string(),
        },
    }
}

/// Up to the first 4 KiB of the file (one SQLCipher page).
fn read_head(path: &Path) -> Vec<u8> {
    use std::io::Read;
    let mut head = Vec::with_capacity(4096);
    if let Ok(file) = fs::File::open(path) {
        let _ = file.take(4096).read_to_end(&mut head);
    }
    head
}

/// Shannon entropy above 7 bits per byte over at least 512 bytes.
fn looks_random(bytes: &[u8]) -> bool {
    if bytes.len() < 512 {
        return false;
    }
    let mut counts = [0usize; 256];
    for &b in bytes {
        counts[b as usize] += 1;
    }
    let len = bytes.len() as f64;
    let entropy: f64 = counts
        .iter()
        .filter(|&&c| c > 0)
        .map(|&c| {
            let p = c as f64 / len;
            -p * p.log2()
        })
        .sum();
    entropy > 7.0
}

/// `path` with `suffix` appended to its file name (`index.db` + `-wal`).
fn sidecar(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(suffix);
    PathBuf::from(name)
}

fn remove_if_exists(path: &Path) -> Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(StoreError::io(path, err)),
    }
}

/// Rename the database and its `-wal`/`-shm` files to
/// `<name>.corrupt-<unix ms>[-wal|-shm]`, returning the new main path.
fn quarantine(path: &Path) -> Result<PathBuf> {
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis());
    let moved = sidecar(path, &format!(".corrupt-{ms}"));
    for suffix in ["", "-wal", "-shm"] {
        let from = sidecar(path, suffix);
        if from.exists() {
            let to = sidecar(&moved, suffix);
            fs::rename(&from, &to).map_err(|err| StoreError::io(&from, err))?;
        }
    }
    Ok(moved)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn random_bytes_look_random_and_text_does_not() {
        let mut random = vec![0u8; 4096];
        getrandom::fill(&mut random).unwrap();
        assert!(looks_random(&random));
        assert!(!looks_random(&b"not a database ".repeat(300)));
        assert!(!looks_random(&[0u8; 4096]));
        assert!(!looks_random(&random[..100]));
    }

    #[test]
    fn sidecar_appends_to_the_file_name() {
        assert_eq!(
            sidecar(Path::new("/a/index.db"), "-wal"),
            PathBuf::from("/a/index.db-wal")
        );
    }

    #[test]
    fn debug_never_prints_the_key() {
        let enc = Encryption::Key(Zeroizing::new(vec![0xAB; 32]));
        assert_eq!(format!("{enc:?}"), "Key(<redacted>)");
        assert_eq!(enc.literal().len(), 67);
        assert!(enc.literal().starts_with("x'abab"));
    }
}
