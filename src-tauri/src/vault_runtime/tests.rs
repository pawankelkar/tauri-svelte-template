//! Lifecycle tests without a Tauri runtime: a scratch app data dir, a file
//! key store and a recording event sink.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use ostralith_core::CoreError;
use ostralith_store::key::KeyStore;
use ostralith_vault::{FsChange, FsChangeKind, RelPath};

use super::registry::Registry;
use super::*;
use crate::commands::search::IndexStatus;
use crate::commands::test_support::{json_round_trip, scratch_dir};
use crate::commands::vault::FsChangedPayload;

#[derive(Debug, Clone, PartialEq)]
enum Event {
    Current(Option<String>),
    Fs(FsChangedPayload),
    Status(IndexStatus),
}

#[derive(Default)]
struct Recorder(Mutex<Vec<Event>>);

impl Recorder {
    fn events(&self) -> Vec<Event> {
        self.0.lock().unwrap().clone()
    }
}

impl EventSink for Recorder {
    fn current_changed(&self, info: Option<&VaultInfo>) {
        self.0
            .lock()
            .unwrap()
            .push(Event::Current(info.map(|i| i.id.clone())));
    }
    fn fs_changed(&self, payload: &FsChangedPayload) {
        self.0.lock().unwrap().push(Event::Fs(payload.clone()));
    }
    fn index_status(&self, status: IndexStatus) {
        self.0.lock().unwrap().push(Event::Status(status));
    }
}

struct Fixture {
    dir: PathBuf,
    runtime: VaultRuntime,
    events: Arc<Recorder>,
}

impl Fixture {
    fn new(name: &str) -> Self {
        let dir = scratch_dir("vault-runtime", name);
        let (runtime, events) = runtime_on(&dir);
        Self {
            dir,
            runtime,
            events,
        }
    }

    fn app_data(&self) -> PathBuf {
        self.dir.join("appdata")
    }

    /// A folder of notes under the scratch dir.
    fn folder(&self, name: &str, files: &[(&str, &str)]) -> PathBuf {
        let root = self.dir.join(name);
        for (path, content) in files {
            let abs = root.join(path);
            fs::create_dir_all(abs.parent().unwrap()).unwrap();
            fs::write(abs, content).unwrap();
        }
        fs::create_dir_all(&root).unwrap();
        root
    }

    /// Opens `root` and waits for the initial index.
    fn open(&self, root: &Path) -> Arc<OpenVault> {
        self.runtime.open_path(root.to_str().unwrap()).unwrap();
        let vault = self.runtime.current().unwrap();
        vault.flush();
        vault
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.runtime.shutdown();
        let _ = fs::remove_dir_all(&self.dir);
    }
}

fn runtime_on(dir: &Path) -> (VaultRuntime, Arc<Recorder>) {
    let events = Arc::new(Recorder::default());
    let app_data = dir.join("appdata");
    let runtime = VaultRuntime::new(
        &app_data,
        KeyStore::File(app_data.join("dev-keys")),
        events.clone(),
    );
    (runtime, events)
}

fn paths<T>(items: &[T], path: impl Fn(&T) -> &str) -> Vec<String> {
    items.iter().map(|i| path(i).to_string()).collect()
}

fn search_paths(vault: &OpenVault, query: &str) -> Vec<String> {
    paths(&vault.search(query, 20).unwrap(), |h| &h.path)
}

fn backlink_sources(vault: &OpenVault, path: &str) -> Vec<String> {
    let mut sources = paths(&vault.backlinks(path).unwrap(), |b| &b.source_path);
    sources.sort();
    sources
}

const NOTES: &[(&str, &str)] = &[
    (
        "Alpha.md",
        "---\ntags: [project]\n---\n# Alpha\n\nSee [[Beta]] and [[Missing]]. #idea\n",
    ),
    ("Beta.md", "# Beta\n\nA banana split recipe.\n"),
    (
        "Sub/Gamma.md",
        "Links to [[beta|the beta]] and [a](../Alpha.md).\n",
    ),
    ("image.png", "not really a png"),
];

#[test]
fn no_vault_is_reported_until_one_is_opened() {
    let f = Fixture::new("no-vault");
    assert!(matches!(f.runtime.current(), Err(CoreError::NoVault)));
    assert!(f.runtime.list().is_empty());
    assert_eq!(f.runtime.current_info(), None);
    f.runtime.close();
    assert!(f.events.events().is_empty());
}

#[test]
fn open_index_search_and_backlinks() {
    let f = Fixture::new("open-index");
    let root = f.folder("Notes", NOTES);
    let vault = f.open(&root);
    let info = vault.info().clone();
    assert_eq!(info.name, "Notes");
    assert_eq!(info.encryption, DbEncryption::None);
    assert!(root.join(".ostralith/vault.json").is_file());
    assert!(f
        .app_data()
        .join("vaults")
        .join(&info.id)
        .join("index.db")
        .is_file());

    let status = vault.index_status();
    assert!(!status.indexing);
    assert_eq!((status.done, status.total, status.note_count), (3, 3, 3));
    let events = f.events.events();
    assert_eq!(events[0], Event::Current(Some(info.id.clone())));
    assert!(matches!(events.last(), Some(Event::Status(s)) if !s.indexing && s.note_count == 3));

    assert_eq!(search_paths(&vault, "banana"), ["Beta.md"]);
    assert_eq!(search_paths(&vault, "tag:project"), ["Alpha.md"]);
    assert_eq!(search_paths(&vault, "#idea"), ["Alpha.md"]);
    // Frontmatter isn't body text.
    assert!(search_paths(&vault, "tags").is_empty());

    let quick = vault.quick_open("gam", 10);
    assert_eq!(quick[0].path, "Sub/Gamma.md");
    assert_eq!(quick[0].title, "Gamma");
    assert_eq!(vault.quick_open("", 10).len(), 3);

    assert_eq!(
        backlink_sources(&vault, "Beta.md"),
        ["Alpha.md", "Sub/Gamma.md"]
    );
    assert_eq!(backlink_sources(&vault, "Alpha.md"), ["Sub/Gamma.md"]);
    let alpha_backlink = &vault.backlinks("Alpha.md").unwrap()[0];
    assert_eq!(alpha_backlink.source_title, "Gamma");
    assert_eq!(alpha_backlink.line, 0);

    let note = vault.read_note("Alpha.md").unwrap();
    assert_eq!(note.title, "Alpha");
    assert_eq!(note.frontmatter.unwrap()["tags"][0], "project");
    assert_eq!(note.hash, ostralith_vault::hash_bytes(&note.content));

    let tree = vault.list_tree().unwrap();
    let names: Vec<&str> = tree.iter().map(|n| n.name.as_str()).collect();
    assert_eq!(names, ["Sub", "Alpha.md", "Beta.md", "image.png"]);
    assert_eq!(tree[0].children[0].path, "Sub/Gamma.md");

    let link = vault.resolve_link("Sub/Gamma.md", "Beta#Intro|x").unwrap();
    assert_eq!(
        (link.path.as_deref(), link.heading.as_deref(), link.exists),
        (Some("Beta.md"), Some("Intro"), true)
    );
    let missing = vault.resolve_link("Alpha.md", "Missing").unwrap();
    assert_eq!(
        (missing.path.as_deref(), missing.exists),
        (Some("Missing.md"), false)
    );
    let local = vault.resolve_link("Alpha.md", "#Heading").unwrap();
    assert_eq!(
        (local.path.as_deref(), local.exists),
        (Some("Alpha.md"), true)
    );
    let image = vault.resolve_link("Alpha.md", "image.png").unwrap();
    assert_eq!(
        (image.path.as_deref(), image.exists),
        (Some("image.png"), true)
    );

    let db = vault.db_status().unwrap();
    assert_eq!((db.note_count, db.integrity_ok), (3, true));
    assert_eq!(db.encryption, DbEncryption::None);
}

#[test]
fn incremental_sync_on_reopen_picks_up_offline_edits() {
    let f = Fixture::new("reopen-sync");
    let root = f.folder("Notes", NOTES);
    f.open(&root);
    f.runtime.close();
    fs::write(root.join("Beta.md"), "# Beta\n\nNow about cherries.\n").unwrap();
    fs::write(root.join("Missing.md"), "# Missing\n").unwrap();
    fs::remove_file(root.join("Sub/Gamma.md")).unwrap();

    let vault = f.open(&root);
    assert_eq!(search_paths(&vault, "cherries"), ["Beta.md"]);
    assert!(search_paths(&vault, "banana").is_empty());
    assert_eq!(vault.index_status().note_count, 3);
    // Gamma is gone, and Alpha's [[Missing]] now resolves.
    assert_eq!(backlink_sources(&vault, "Beta.md"), ["Alpha.md"]);
    assert_eq!(backlink_sources(&vault, "Missing.md"), ["Alpha.md"]);
}

#[test]
fn write_note_detects_conflicts_and_reindexes() {
    let f = Fixture::new("write-conflict");
    let root = f.folder("Notes", NOTES);
    let vault = f.open(&root);
    let note = vault.read_note("Beta.md").unwrap();

    let err = vault
        .write_note("Beta.md", "x", Some("not-the-hash"))
        .unwrap_err();
    assert!(matches!(err, CoreError::Conflict { ref path } if path == "Beta.md"));

    let written = vault
        .write_note("Beta.md", "# Beta\n\nMango season.\n", Some(&note.hash))
        .unwrap();
    assert_ne!(written.hash, note.hash);
    assert_eq!(search_paths(&vault, "mango"), ["Beta.md"]);
    assert!(search_paths(&vault, "banana").is_empty());

    // The old hash is stale now.
    let err = vault
        .write_note("Beta.md", "late", Some(&note.hash))
        .unwrap_err();
    assert!(matches!(err, CoreError::Conflict { .. }));

    // A new note resolves links that pointed nowhere, right away.
    vault.write_note("Missing.md", "# Found\n", None).unwrap();
    assert_eq!(backlink_sources(&vault, "Missing.md"), ["Alpha.md"]);
    assert_eq!(vault.quick_open("found", 5)[0].path, "Missing.md");
}

#[test]
fn create_note_and_folder() {
    let f = Fixture::new("create");
    let root = f.folder("Notes", &[]);
    let vault = f.open(&root);
    let a = vault.create_note(None, None).unwrap();
    let b = vault.create_note(None, None).unwrap();
    assert_eq!(
        (a.path.as_str(), a.title.as_str()),
        ("Untitled.md", "Untitled")
    );
    assert_eq!(b.path, "Untitled 1.md");
    let titled = vault.create_note(Some("Ideas"), Some("Big plan")).unwrap();
    assert_eq!(titled.path, "Ideas/Big plan.md");
    assert_eq!(titled.title, "Big plan");
    assert_eq!(
        vault.read_note("Ideas/Big plan.md").unwrap().content,
        "# Big plan\n\n"
    );
    vault.create_folder("Empty").unwrap();
    assert!(root.join("Empty").is_dir());
    assert!(matches!(
        vault.create_folder("Empty"),
        Err(CoreError::AlreadyExists { .. })
    ));
    assert_eq!(vault.index_status().note_count, 3);
}

#[test]
fn rename_rewrites_links_and_moves_backlinks() {
    let f = Fixture::new("rename");
    let root = f.folder("Notes", NOTES);
    let vault = f.open(&root);

    let result = vault.rename_path("Beta.md", "Fruit/Bee.md").unwrap();
    assert_eq!(result.path, "Fruit/Bee.md");
    assert_eq!((result.updated_links, result.updated_files), (2, 2));
    let alpha = fs::read_to_string(root.join("Alpha.md")).unwrap();
    assert!(alpha.contains("[[Bee]]"), "{alpha}");
    assert_eq!(
        backlink_sources(&vault, "Fruit/Bee.md"),
        ["Alpha.md", "Sub/Gamma.md"]
    );
    assert!(vault.backlinks("Beta.md").unwrap().is_empty());
    assert_eq!(search_paths(&vault, "banana"), ["Fruit/Bee.md"]);
    assert!(vault
        .quick_open("beta", 10)
        .iter()
        .all(|m| m.path != "Beta.md"));

    // Folders move their notes and keep inbound links.
    let result = vault.rename_path("Fruit", "Archive/Fruit").unwrap();
    assert_eq!(result.path, "Archive/Fruit");
    assert_eq!(
        backlink_sources(&vault, "Archive/Fruit/Bee.md"),
        ["Alpha.md", "Sub/Gamma.md"]
    );
    assert_eq!(search_paths(&vault, "banana"), ["Archive/Fruit/Bee.md"]);
    vault.flush();
    assert_eq!(vault.index_status().note_count, 3);

    assert!(matches!(
        vault.rename_path("Nope.md", "Other.md"),
        Err(CoreError::NotFound { .. })
    ));
}

#[test]
fn trash_removes_from_search_and_unresolves_links() {
    let f = Fixture::new("trash");
    let root = f.folder("Notes", NOTES);
    let vault = f.open(&root);

    vault.trash_path("Beta.md").unwrap();
    assert!(root.join(".trash/Beta.md").is_file());
    assert!(search_paths(&vault, "banana").is_empty());
    assert!(vault.backlinks("Beta.md").unwrap().is_empty());
    let link = vault.resolve_link("Alpha.md", "Beta").unwrap();
    assert!(!link.exists);

    vault.trash_path("Sub").unwrap();
    assert!(root.join(".trash/Sub/Gamma.md").is_file());
    assert!(vault.quick_open("gamma", 5).is_empty());
    assert!(vault.backlinks("Alpha.md").unwrap().is_empty());
    vault.flush();
    assert_eq!(vault.index_status().note_count, 1);
}

#[test]
fn external_changes_are_indexed_and_reported() {
    let f = Fixture::new("external");
    let root = f.folder("Notes", NOTES);
    let vault = f.open(&root);

    fs::write(root.join("Kiwi.md"), "# Kiwi\n\nLinks [[Alpha]].\n").unwrap();
    fs::write(root.join("Missing.md"), "now exists\n").unwrap();
    let rel = |p: &str| RelPath::new(p).unwrap();
    vault.handle_fs_changes(&[
        FsChange {
            path: rel("Kiwi.md"),
            kind: FsChangeKind::Created,
            old_path: None,
        },
        FsChange {
            path: rel("Missing.md"),
            kind: FsChangeKind::Created,
            old_path: None,
        },
    ]);
    assert_eq!(search_paths(&vault, "kiwi"), ["Kiwi.md"]);
    assert_eq!(
        backlink_sources(&vault, "Alpha.md"),
        ["Kiwi.md", "Sub/Gamma.md"]
    );
    assert_eq!(backlink_sources(&vault, "Missing.md"), ["Alpha.md"]);
    assert!(f.events.events().iter().any(|e| matches!(
        e,
        Event::Fs(p) if p.changes.iter().any(|c| c.path == "Kiwi.md")
    )));

    // An external rename and a delete.
    fs::rename(root.join("Kiwi.md"), root.join("Sub/Kiwi2.md")).unwrap();
    fs::remove_file(root.join("Beta.md")).unwrap();
    vault.handle_fs_changes(&[
        FsChange {
            path: rel("Sub/Kiwi2.md"),
            kind: FsChangeKind::Renamed,
            old_path: Some(rel("Kiwi.md")),
        },
        FsChange {
            path: rel("Beta.md"),
            kind: FsChangeKind::Removed,
            old_path: None,
        },
    ]);
    assert_eq!(search_paths(&vault, "kiwi"), ["Sub/Kiwi2.md"]);
    assert!(search_paths(&vault, "banana").is_empty());
    assert!(vault.backlinks("Beta.md").unwrap().is_empty());
    // The live watcher may report the same edits too; ours is among them.
    assert!(f.events.events().iter().any(|e| matches!(
        e,
        Event::Fs(p) if p.changes.iter().any(|c| c.path == "Sub/Kiwi2.md"
            && c.old_path.as_deref() == Some("Kiwi.md"))
    )));
}

#[test]
fn registry_persists_most_recent_first() {
    let f = Fixture::new("registry");
    let one = f.folder("One", &[("a.md", "a")]);
    let two = f.folder("Two", &[("b.md", "b")]);
    let first = f.open(&one).info().clone();
    let second = f.open(&two).info().clone();
    assert!(second.last_opened_at >= first.last_opened_at);

    let ids = |list: Vec<VaultInfo>| list.into_iter().map(|v| v.id).collect::<Vec<_>>();
    assert_eq!(ids(f.runtime.list()), [second.id.clone(), first.id.clone()]);

    // A fresh runtime on the same app data dir sees the same registry.
    let (again, _events) = runtime_on(&f.dir);
    assert_eq!(ids(again.list()), [second.id.clone(), first.id.clone()]);
    drop(again);

    // Reopening moves a vault to the front; the previous one is closed.
    f.runtime.open_by_id(&first.id).unwrap();
    f.runtime.current().unwrap().flush();
    assert_eq!(ids(f.runtime.list()), [first.id.clone(), second.id.clone()]);
    assert_eq!(f.runtime.current_info().unwrap().id, first.id);

    // Forgetting the open vault closes it; files stay.
    f.runtime.forget(&first.id).unwrap();
    assert!(f.runtime.current_info().is_none());
    assert_eq!(ids(f.runtime.list()), [second.id.as_str()]);
    assert!(one.join("a.md").is_file());
    f.runtime.forget("unknown").unwrap();

    assert!(matches!(
        f.runtime.open_by_id("unknown"),
        Err(CoreError::NotFound { .. })
    ));
    // A vault whose folder is gone: NotFound, but the entry is kept.
    fs::rename(&two, f.dir.join("Moved")).unwrap();
    assert!(matches!(
        f.runtime.open_by_id(&second.id),
        Err(CoreError::NotFound { .. })
    ));
    assert_eq!(ids(f.runtime.list()), [second.id.as_str()]);

    let registry = Registry {
        version: 1,
        vaults: vec![second.clone()],
    };
    assert_eq!(
        json_round_trip("vault-runtime", "registry-json", "vaults.json", &registry),
        registry
    );
    let events = f.events.events();
    assert!(events.contains(&Event::Current(None)));
}

#[test]
fn create_vault_refuses_non_empty_folders() {
    let f = Fixture::new("create-vault");
    let parent = f.dir.join("parent");
    fs::create_dir_all(parent.join("Taken")).unwrap();
    fs::write(parent.join("Taken/x.md"), "x").unwrap();
    let parent_str = parent.to_str().unwrap();

    let err = f
        .runtime
        .create(parent_str, "Taken", DbEncryption::None)
        .unwrap_err();
    assert!(matches!(err, CoreError::AlreadyExists { .. }));
    assert!(matches!(
        f.runtime.create(parent_str, "../x", DbEncryption::None),
        Err(CoreError::InvalidInput { .. })
    ));
    assert!(matches!(
        f.runtime.create("relative", "X", DbEncryption::None),
        Err(CoreError::InvalidInput { .. })
    ));

    let info = f
        .runtime
        .create(parent_str, "Fresh", DbEncryption::None)
        .unwrap();
    assert_eq!(info.name, "Fresh");
    assert!(parent.join("Fresh/.ostralith/vault.json").is_file());
    assert_eq!(f.runtime.current_info().unwrap().id, info.id);
}

fn db_header(f: &Fixture, id: &str) -> Vec<u8> {
    let bytes = fs::read(f.app_data().join("vaults").join(id).join("index.db")).unwrap();
    bytes[..16].to_vec()
}

#[test]
fn plain_and_encrypted_databases() {
    let f = Fixture::new("encryption");
    let parent = f.dir.join("parent");
    fs::create_dir_all(&parent).unwrap();
    let parent_str = parent.to_str().unwrap();

    let plain = f
        .runtime
        .create(parent_str, "Plain", DbEncryption::None)
        .unwrap();
    f.runtime.current().unwrap().flush();
    assert_eq!(db_header(&f, &plain.id), b"SQLite format 3\0");

    let secret = f
        .runtime
        .create(parent_str, "Secret", DbEncryption::Keychain)
        .unwrap();
    let vault = f.runtime.current().unwrap();
    vault
        .write_note("n.md", "# Secret\n\nplutonium\n", None)
        .unwrap();
    vault.flush();
    assert_eq!(
        vault.db_status().unwrap().encryption,
        DbEncryption::Keychain
    );
    drop(vault);
    f.runtime.close();
    assert_ne!(db_header(&f, &secret.id), b"SQLite format 3\0");
    let key_file = f
        .app_data()
        .join("dev-keys")
        .join(format!("vault-db-{}.key", secret.id));
    assert!(key_file.is_file());

    // Without a registry entry the encryption is detected from the file.
    fs::remove_file(f.app_data().join(REGISTRY_FILE)).unwrap();
    let vault = f.open(&parent.join("Secret"));
    assert_eq!(vault.info().encryption, DbEncryption::Keychain);
    assert!(vault.db_status().unwrap().integrity_ok);
    assert_eq!(search_paths(&vault, "plutonium"), ["n.md"]);

    // A lost key means a fresh (reindexed) cache, not an error.
    drop(vault);
    f.runtime.close();
    fs::remove_file(&key_file).unwrap();
    let vault = f.open(&parent.join("Secret"));
    assert_eq!(search_paths(&vault, "plutonium"), ["n.md"]);
    assert_eq!(vault.db_status().unwrap().note_count, 1);
}

#[test]
fn corrupt_database_is_rebuilt_on_open_and_reindex_works() {
    let f = Fixture::new("corrupt");
    let root = f.folder("Notes", NOTES);
    let id = f.open(&root).info().id.clone();
    f.runtime.close();

    let data = f.app_data().join("vaults").join(&id);
    for suffix in ["-wal", "-shm"] {
        let _ = fs::remove_file(data.join(format!("index.db{suffix}")));
    }
    fs::write(data.join("index.db"), vec![0x5a; 8192]).unwrap();

    let vault = f.open(&root);
    assert_eq!(
        backlink_sources(&vault, "Beta.md"),
        ["Alpha.md", "Sub/Gamma.md"]
    );
    assert_eq!(search_paths(&vault, "banana"), ["Beta.md"]);
    let quarantined = fs::read_dir(&data)
        .unwrap()
        .filter_map(Result::ok)
        .any(|e| e.file_name().to_string_lossy().contains(".corrupt-"));
    assert!(quarantined);

    vault.reindex();
    vault.flush();
    let status = vault.index_status();
    assert!(!status.indexing);
    assert_eq!(status.note_count, 3);
    assert_eq!(search_paths(&vault, "banana"), ["Beta.md"]);
    assert_eq!(vault.db_status().unwrap().note_count, 3);
}

#[test]
fn backup_init_snapshot_history_and_restore() {
    let f = Fixture::new("backup");
    let root = f.folder("Notes", NOTES);
    let vault = f.open(&root);
    let never = |_: &str| -> Result<(), CoreError> { panic!("no remote, no network") };

    assert!(!vault.backup_status().unwrap().initialized);
    assert!(vault.note_history("Beta.md", 10).unwrap().is_empty());
    assert!(matches!(
        vault.backup_now(None, &never),
        Err(CoreError::InvalidInput { .. })
    ));

    let status = vault.backup_init().unwrap();
    assert!(status.initialized);
    assert_eq!(status.changed_files, 0);
    let first = status.last_snapshot.unwrap();
    assert!(fs::read_to_string(root.join(".gitignore"))
        .unwrap()
        .contains(".trash/"));

    let original = vault.read_note("Beta.md").unwrap();
    vault
        .write_note("Beta.md", "# Beta\n\nPapaya now.\n", Some(&original.hash))
        .unwrap();
    assert_eq!(vault.backup_status().unwrap().changed_files, 1);
    let snap = vault
        .backup_now(Some("Edit beta"), &never)
        .unwrap()
        .unwrap();
    assert_eq!(snap.message, "Edit beta");
    assert_eq!(snap.files_changed, 1);
    assert!(vault.backup_now(None, &never).unwrap().is_none());

    let history = vault.note_history("Beta.md", 10).unwrap();
    assert_eq!(
        paths(&history, |s| &s.id),
        [snap.id.clone(), first.id.clone()]
    );

    let restored = vault.note_restore("Beta.md", &first.id).unwrap();
    assert_eq!(
        fs::read_to_string(root.join("Beta.md")).unwrap(),
        original.content
    );
    assert_eq!(restored.hash, original.hash);
    assert_eq!(search_paths(&vault, "banana"), ["Beta.md"]);
    assert!(search_paths(&vault, "papaya").is_empty());
}

#[test]
fn push_waits_for_the_network_policy() {
    let f = Fixture::new("backup-push");
    let root = f.folder("Notes", NOTES);
    let vault = f.open(&root);
    vault.backup_init().unwrap();
    let status = vault
        .backup_set_remote(Some("git@example.invalid:me/notes.git"))
        .unwrap();
    assert_eq!(
        status.remote.as_deref(),
        Some("git@example.invalid:me/notes.git")
    );

    vault.write_note("New.md", "new", None).unwrap();
    let asked = Mutex::new(Vec::new());
    let deny = |url: &str| -> Result<(), CoreError> {
        asked.lock().unwrap().push(url.to_string());
        Err(CoreError::Offline {
            host: "example.invalid".into(),
        })
    };
    let err = vault.backup_now(None, &deny).unwrap_err();
    assert!(matches!(err, CoreError::Offline { .. }));
    assert_eq!(
        *asked.lock().unwrap(),
        ["https://example.invalid/me/notes.git"]
    );
    // The snapshot itself was kept; it just wasn't pushed.
    let status = vault.backup_status().unwrap();
    assert_eq!(status.changed_files, 0);
    assert!(status.ahead >= 1);

    let cleared = vault.backup_set_remote(None).unwrap();
    assert_eq!(cleared.remote, None);
}
