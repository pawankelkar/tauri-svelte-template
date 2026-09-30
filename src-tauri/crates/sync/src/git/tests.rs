//! Local-only tests: temp dirs and `file://` bare repos, no network.

use std::fs;
use std::path::Path;

use git2::{Repository, RepositoryInitOptions};
use tempfile::TempDir;

use super::*;
use crate::git::PullOutcome;

fn write(root: &Path, rel: &str, content: &str) {
    let path = root.join(rel);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, content).unwrap();
}

fn vault() -> (TempDir, GitBackup) {
    let dir = TempDir::new().unwrap();
    write(dir.path(), "Welcome.md", "# Welcome\n");
    let backup = GitBackup::init(dir.path(), "Test", "test@example.com").unwrap();
    (dir, backup)
}

fn bare_remote() -> (TempDir, String) {
    let dir = TempDir::new().unwrap();
    let mut opts = RepositoryInitOptions::new();
    opts.bare(true).initial_head(DEFAULT_BRANCH);
    Repository::init_opts(dir.path(), &opts).unwrap();
    let url = format!("file://{}", dir.path().display());
    (dir, url)
}

fn tree_paths(backup: &GitBackup) -> Vec<String> {
    let tree = backup.head_commit().unwrap().unwrap().tree().unwrap();
    let mut out = Vec::new();
    tree.walk(git2::TreeWalkMode::PreOrder, |dir, entry| {
        if entry.kind() == Some(git2::ObjectType::Blob) {
            out.push(format!("{dir}{}", entry.name().unwrap()));
        }
        git2::TreeWalkResult::Ok
    })
    .unwrap();
    out.sort();
    out
}

#[test]
fn open_returns_none_for_plain_folders_and_does_not_search_parents() {
    let dir = TempDir::new().unwrap();
    assert!(GitBackup::open(dir.path()).unwrap().is_none());

    GitBackup::init(dir.path(), "T", "t@e").unwrap();
    assert!(GitBackup::open(dir.path()).unwrap().is_some());
    let nested = dir.path().join("Nested vault");
    fs::create_dir(&nested).unwrap();
    assert!(GitBackup::open(&nested).unwrap().is_none());
}

#[test]
fn init_creates_repo_on_main_with_gitignore_and_initial_commit() {
    let (dir, backup) = vault();
    assert!(dir.path().join(".git").is_dir());
    assert_eq!(backup.branch().unwrap(), "main");

    let gitignore = fs::read_to_string(dir.path().join(".gitignore")).unwrap();
    for entry in GITIGNORE_ENTRIES {
        assert!(gitignore.lines().any(|l| l == *entry), "{entry} missing");
    }
    let history = backup.recent(10).unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].message, "Start Ostralith backup");
    assert_eq!(history[0].id.len(), 40);
    assert_eq!(history[0].files_changed, 2);
    assert_eq!(tree_paths(&backup), vec![".gitignore", "Welcome.md"]);
    assert_eq!(backup.changed_files().unwrap(), 0);
}

#[test]
fn init_is_idempotent() {
    let (dir, backup) = vault();
    let head = backup.recent(1).unwrap()[0].id.clone();
    let before = fs::read_to_string(dir.path().join(".gitignore")).unwrap();

    let again = GitBackup::init(dir.path(), "Test", "test@example.com").unwrap();
    assert_eq!(again.recent(10).unwrap().len(), 1);
    assert_eq!(again.recent(1).unwrap()[0].id, head);
    assert_eq!(
        fs::read_to_string(dir.path().join(".gitignore")).unwrap(),
        before
    );
    assert_eq!(again.changed_files().unwrap(), 0);
}

#[test]
fn init_merges_into_an_existing_gitignore() {
    let dir = TempDir::new().unwrap();
    write(dir.path(), ".gitignore", "node_modules\n/.trash\n*.log");
    GitBackup::init(dir.path(), "T", "t@e").unwrap();
    let gitignore = fs::read_to_string(dir.path().join(".gitignore")).unwrap();
    let lines: Vec<&str> = gitignore.lines().collect();
    assert_eq!(&lines[..3], &["node_modules", "/.trash", "*.log"]);
    // `/.trash` already covers `.trash/`.
    assert!(!lines.contains(&".trash/"));
    for entry in [".ostralith/cache/", "Attachments/Audio/", ".DS_Store"] {
        assert_eq!(lines.iter().filter(|l| **l == entry).count(), 1);
    }
    ensure_gitignore(dir.path()).unwrap();
    assert_eq!(
        fs::read_to_string(dir.path().join(".gitignore")).unwrap(),
        gitignore
    );
}

#[test]
fn init_reuses_an_existing_repo_without_committing() {
    let dir = TempDir::new().unwrap();
    write(dir.path(), "a.md", "a");
    {
        let first = GitBackup::init(dir.path(), "T", "t@e").unwrap();
        assert_eq!(first.recent(10).unwrap().len(), 1);
    }
    fs::remove_file(dir.path().join(".gitignore")).unwrap();
    let backup = GitBackup::init(dir.path(), "T", "t@e").unwrap();
    assert_eq!(backup.recent(10).unwrap().len(), 1);
    assert!(dir.path().join(".gitignore").exists());
}

#[test]
fn snapshot_returns_none_when_clean() {
    let (_dir, backup) = vault();
    assert_eq!(backup.snapshot(None).unwrap(), None);
    assert_eq!(backup.snapshot(Some("again")).unwrap(), None);
    assert_eq!(backup.recent(10).unwrap().len(), 1);
}

#[test]
fn snapshot_picks_up_adds_modifications_and_deletions() {
    let (dir, backup) = vault();
    write(dir.path(), "Projects/Plan.md", "plan v1");
    write(dir.path(), "Welcome.md", "# Welcome, edited\n");
    let s = backup.snapshot(None).unwrap().expect("changes");
    assert_eq!(s.files_changed, 2);
    assert!(s.message.starts_with("Snapshot 20"), "{}", s.message);
    let full = backup
        .repo()
        .find_commit(Oid::from_str(&s.id).unwrap())
        .unwrap();
    let body = full.message().unwrap();
    assert!(body.contains("A Projects/Plan.md"), "{body}");
    assert!(body.contains("M Welcome.md"), "{body}");

    fs::remove_file(dir.path().join("Welcome.md")).unwrap();
    let s = backup
        .snapshot(Some("  remove welcome \n"))
        .unwrap()
        .expect("deletion");
    assert_eq!(s.message, "remove welcome");
    assert_eq!(s.files_changed, 1);
    assert_eq!(tree_paths(&backup), vec![".gitignore", "Projects/Plan.md"]);
    assert_eq!(backup.snapshot(None).unwrap(), None);
}

#[test]
fn default_message_lists_at_most_ten_lines() {
    let (dir, backup) = vault();
    for i in 0..15 {
        write(dir.path(), &format!("n{i:02}.md"), "x");
    }
    let s = backup.snapshot(None).unwrap().unwrap();
    assert_eq!(s.files_changed, 15);
    let commit = backup
        .repo()
        .find_commit(Oid::from_str(&s.id).unwrap())
        .unwrap();
    let body: Vec<&str> = commit.message().unwrap().lines().skip(2).collect();
    assert_eq!(body.len(), 10, "{body:?}");
    assert_eq!(body[9], "… and 6 more files");
}

#[test]
fn ignored_paths_are_excluded() {
    let (dir, backup) = vault();
    write(dir.path(), ".trash/Old.md", "old");
    write(dir.path(), ".ostralith/cache/thumb.bin", "x");
    write(dir.path(), "Attachments/Audio/memo.m4a", "x");
    write(dir.path(), "Attachments/pic.png", "png");
    write(dir.path(), ".DS_Store", "x");
    write(dir.path(), "Sub/.DS_Store", "x");
    write(dir.path(), ".ostralith/vault.json", "{}");

    assert_eq!(backup.changed_files().unwrap(), 2);
    let s = backup.snapshot(None).unwrap().unwrap();
    assert_eq!(s.files_changed, 2);
    assert_eq!(
        tree_paths(&backup),
        vec![
            ".gitignore",
            ".ostralith/vault.json",
            "Attachments/pic.png",
            "Welcome.md"
        ]
    );
    assert_eq!(backup.changed_files().unwrap(), 0);
}

#[test]
fn history_for_lists_only_commits_touching_the_file_newest_first() {
    let (dir, backup) = vault();
    write(dir.path(), "a.md", "a1");
    let a1 = backup.snapshot(Some("a1")).unwrap().unwrap();
    write(dir.path(), "b.md", "b1");
    backup.snapshot(Some("b1")).unwrap().unwrap();
    write(dir.path(), "a.md", "a2");
    let a2 = backup.snapshot(Some("a2")).unwrap().unwrap();
    write(dir.path(), "b.md", "b2");
    backup.snapshot(Some("b2")).unwrap().unwrap();

    let history = backup.history_for("a.md", 10).unwrap();
    assert_eq!(
        history.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(),
        vec![a2.id.as_str(), a1.id.as_str()]
    );
    assert_eq!(backup.history_for("a.md", 1).unwrap(), vec![a2.clone()]);
    assert!(backup.history_for("a.md", 0).unwrap().is_empty());
    assert_eq!(backup.history_for("Welcome.md", 10).unwrap().len(), 1);
    assert!(backup.history_for("missing.md", 10).unwrap().is_empty());
    assert!(backup.history_for("a.md", 10).unwrap()[0].time_ms > 1.0e12);
}

#[test]
fn history_skips_deletions_and_resumes_after_recreation() {
    let (dir, backup) = vault();
    write(dir.path(), "a.md", "first life");
    let born = backup.snapshot(Some("born")).unwrap().unwrap();
    fs::remove_file(dir.path().join("a.md")).unwrap();
    backup.snapshot(Some("deleted")).unwrap().unwrap();
    write(dir.path(), "a.md", "second life, quite different");
    let reborn = backup.snapshot(Some("reborn")).unwrap().unwrap();
    let ids: Vec<String> = backup
        .history_for("a.md", 10)
        .unwrap()
        .into_iter()
        .map(|s| s.id)
        .collect();
    assert_eq!(ids, vec![reborn.id, born.id]);
}

#[test]
fn history_follows_renames_and_read_at_uses_the_old_name() {
    let (dir, backup) = vault();
    let body = "# Plan\n\nA long enough body that similarity detection pairs the rename.\nLine two.\nLine three.\n";
    write(dir.path(), "Plan.md", body);
    let created = backup.snapshot(Some("create")).unwrap().unwrap();
    fs::remove_file(dir.path().join("Plan.md")).unwrap();
    write(dir.path(), "Projects/Plan 2026.md", body);
    let renamed = backup.snapshot(Some("rename")).unwrap().unwrap();
    assert!(backup
        .repo()
        .find_commit(Oid::from_str(&renamed.id).unwrap())
        .unwrap()
        .message()
        .unwrap()
        .contains("rename"));

    let ids: Vec<String> = backup
        .history_for("Projects/Plan 2026.md", 10)
        .unwrap()
        .into_iter()
        .map(|s| s.id)
        .collect();
    assert_eq!(ids, vec![renamed.id.clone(), created.id.clone()]);
    assert_eq!(
        backup
            .read_at("Projects/Plan 2026.md", &created.id)
            .unwrap(),
        body
    );
    assert_eq!(backup.read_at("Plan.md", &created.id).unwrap(), body);
}

#[test]
fn read_at_returns_old_content() {
    let (dir, backup) = vault();
    write(dir.path(), "Notes/a.md", "version one");
    let v1 = backup.snapshot(None).unwrap().unwrap();
    write(dir.path(), "Notes/a.md", "version two");
    let v2 = backup.snapshot(None).unwrap().unwrap();

    assert_eq!(backup.read_at("Notes/a.md", &v1.id).unwrap(), "version one");
    assert_eq!(backup.read_at("Notes/a.md", &v2.id).unwrap(), "version two");
    assert_eq!(
        backup.read_at("Notes/a.md", &v1.id[..12]).unwrap(),
        "version one"
    );

    let first = backup.recent(10).unwrap().pop().unwrap();
    assert!(matches!(
        backup.read_at("Notes/a.md", &first.id),
        Err(SyncError::NotFound { .. })
    ));
    assert!(matches!(
        backup.read_at("Notes/a.md", "0123456789abcdef0123456789abcdef01234567"),
        Err(SyncError::NotFound { .. })
    ));
    assert!(matches!(
        backup.read_at("Notes", &v1.id),
        Err(SyncError::NotFound { .. })
    ));
    for bad in [
        "",
        "/Notes/a.md",
        "Notes/../a.md",
        "Notes\\a.md",
        "Notes//a.md",
    ] {
        assert!(
            matches!(
                backup.read_at(bad, &v1.id),
                Err(SyncError::InvalidPath { .. })
            ),
            "{bad:?}"
        );
    }
}

#[test]
fn read_at_rejects_binary_files() {
    let (dir, backup) = vault();
    fs::write(dir.path().join("pic.png"), [0xff, 0xfe, 0x00, 0x80]).unwrap();
    let s = backup.snapshot(None).unwrap().unwrap();
    assert!(matches!(
        backup.read_at("pic.png", &s.id),
        Err(SyncError::NotText { .. })
    ));
}

#[test]
fn recent_is_newest_first_and_limited() {
    let (dir, backup) = vault();
    for i in 0..4 {
        write(dir.path(), "a.md", &i.to_string());
        backup.snapshot(Some(&format!("s{i}"))).unwrap();
    }
    let msgs: Vec<String> = backup
        .recent(3)
        .unwrap()
        .into_iter()
        .map(|s| s.message)
        .collect();
    assert_eq!(msgs, vec!["s3", "s2", "s1"]);
    assert_eq!(backup.recent(100).unwrap().len(), 5);
}

#[test]
fn status_counts_changes() {
    let (dir, backup) = vault();
    let st = backup.status().unwrap();
    assert_eq!(st.changed_files, 0);
    assert_eq!(st.remote, None);
    assert_eq!(st.ahead, 0);
    assert_eq!(
        st.last_snapshot.as_ref().unwrap().message,
        "Start Ostralith backup"
    );

    write(dir.path(), "new.md", "n");
    write(dir.path(), "Deep/er/new.md", "n");
    write(dir.path(), "Welcome.md", "changed");
    write(dir.path(), ".trash/x.md", "ignored");
    assert_eq!(backup.status().unwrap().changed_files, 3);
    fs::remove_file(dir.path().join("Welcome.md")).unwrap();
    assert_eq!(backup.status().unwrap().changed_files, 3);

    let snap = backup.snapshot(Some("batch")).unwrap().unwrap();
    let st = backup.status().unwrap();
    assert_eq!(st.changed_files, 0);
    assert_eq!(st.last_snapshot, Some(snap));
}

#[test]
fn signature_prefers_repo_config_then_fallback() {
    let (dir, backup) = vault();
    let mut cfg = backup.repo().config().unwrap();
    cfg.set_str("user.name", "Config Name").unwrap();
    cfg.set_str("user.email", "config@example.com").unwrap();
    write(dir.path(), "a.md", "a");
    let s = backup.snapshot(None).unwrap().unwrap();
    let commit = backup
        .repo()
        .find_commit(Oid::from_str(&s.id).unwrap())
        .unwrap();
    assert_eq!(commit.author().name().unwrap(), "Config Name");
    assert_eq!(commit.committer().email().unwrap(), "config@example.com");

    let fallback = GitBackup::open(dir.path())
        .unwrap()
        .unwrap()
        .with_signature("Given", "g@e");
    assert_eq!(fallback.name, "Given");
    assert_eq!(fallback.email, "g@e");
}

#[test]
fn set_remote_adds_replaces_and_removes_origin() {
    let (_dir, backup) = vault();
    assert_eq!(backup.remote_url().unwrap(), None);
    backup
        .set_remote(Some("https://example.com/a.git"))
        .unwrap();
    assert_eq!(
        backup.remote_url().unwrap().as_deref(),
        Some("https://example.com/a.git")
    );
    backup
        .set_remote(Some(" git@example.com:me/b.git "))
        .unwrap();
    assert_eq!(
        backup.remote_url().unwrap().as_deref(),
        Some("git@example.com:me/b.git")
    );
    assert!(matches!(
        backup.set_remote(Some("https://me:secret@example.com/a.git")),
        Err(SyncError::InvalidRemote { .. })
    ));
    assert!(matches!(
        backup.set_remote(Some("  ")),
        Err(SyncError::InvalidRemote { .. })
    ));
    backup.set_remote(None).unwrap();
    assert_eq!(backup.remote_url().unwrap(), None);
    backup.set_remote(None).unwrap();
    assert_eq!(backup.status().unwrap().remote, None);
}

#[test]
fn push_without_remote_is_an_error() {
    let (_dir, backup) = vault();
    assert!(matches!(
        backup.push(&Credentials::default()),
        Err(SyncError::NoRemote)
    ));
    assert!(matches!(
        backup.fetch(&Credentials::default()),
        Err(SyncError::NoRemote)
    ));
}

#[test]
fn ahead_counts_unpushed_snapshots_against_a_local_bare_remote() {
    let (dir, backup) = vault();
    let (remote_dir, url) = bare_remote();
    assert_eq!(authorization_url(&url), None);
    backup.set_remote(Some(&url)).unwrap();
    write(dir.path(), "a.md", "a");
    backup.snapshot(None).unwrap().unwrap();
    assert_eq!(backup.status().unwrap().ahead, 2);

    let st = backup.push(&Credentials::default()).unwrap();
    assert_eq!(st.ahead, 0);
    assert_eq!(st.remote.as_deref(), Some(url.as_str()));
    let bare = Repository::open_bare(remote_dir.path()).unwrap();
    assert_eq!(
        bare.refname_to_id("refs/heads/main").unwrap().to_string(),
        st.last_snapshot.unwrap().id
    );

    write(dir.path(), "a.md", "a2");
    backup.snapshot(None).unwrap().unwrap();
    write(dir.path(), "b.md", "b");
    backup.snapshot(None).unwrap().unwrap();
    assert_eq!(backup.ahead().unwrap(), 2);
    assert_eq!(backup.push(&Credentials::ssh_agent()).unwrap().ahead, 0);
    // Pushing with nothing new is fine.
    assert_eq!(backup.push(&Credentials::default()).unwrap().ahead, 0);
}

#[test]
fn diverged_push_is_rejected() {
    let (remote_dir, url) = bare_remote();
    let (dir_a, a) = vault();
    write(dir_a.path(), "a.md", "a");
    let a_tip = a.snapshot(None).unwrap().unwrap();
    a.set_remote(Some(&url)).unwrap();
    a.push(&Credentials::default()).unwrap();

    // A second device whose history doesn't contain A's tip.
    let (dir_b, b) = vault();
    write(dir_b.path(), "b.md", "b");
    b.snapshot(None).unwrap();
    b.set_remote(Some(&url)).unwrap();
    let err = b.push(&Credentials::default()).unwrap_err();
    assert!(matches!(err, SyncError::Rejected { .. }), "{err:?}");
    assert!(b.ahead().unwrap() > 0);
    let bare = Repository::open_bare(remote_dir.path()).unwrap();
    assert_eq!(
        bare.refname_to_id("refs/heads/main").unwrap().to_string(),
        a_tip.id
    );
}

/// Device A with a bare `origin`, and device B cloned from it.
fn two_devices() -> (TempDir, TempDir, GitBackup, TempDir, GitBackup) {
    let (remote_dir, url) = bare_remote();
    let (dir_a, a) = vault();
    write(dir_a.path(), "note.md", "line 1\nline 2\nline 3\n");
    a.snapshot(None).unwrap();
    a.set_remote(Some(&url)).unwrap();
    a.push(&Credentials::default()).unwrap();

    let dir_b = TempDir::new().unwrap();
    Repository::clone(&url, dir_b.path()).unwrap();
    let b = GitBackup::open(dir_b.path())
        .unwrap()
        .unwrap()
        .with_signature("B", "b@e");
    (remote_dir, dir_a, a, dir_b, b)
}

#[test]
fn fetch_reports_divergence() {
    let (_r, dir_a, a, _dir_b, b) = two_devices();
    assert_eq!(
        b.fetch(&Credentials::default()).unwrap(),
        Divergence::default()
    );
    write(dir_a.path(), "x.md", "x");
    a.snapshot(None).unwrap();
    a.push(&Credentials::default()).unwrap();
    assert_eq!(
        b.fetch(&Credentials::default()).unwrap(),
        Divergence {
            ahead: 0,
            behind: 1
        }
    );
}

#[test]
fn pull_fast_forwards() {
    let (_r, dir_a, a, dir_b, b) = two_devices();
    assert_eq!(
        b.pull(&Credentials::default(), "B").unwrap(),
        PullOutcome::UpToDate
    );
    write(dir_a.path(), "note.md", "line 1 from A\nline 2\nline 3\n");
    let pushed = a.snapshot(None).unwrap().unwrap();
    a.push(&Credentials::default()).unwrap();

    match b.pull(&Credentials::default(), "B").unwrap() {
        PullOutcome::FastForward { snapshot } => assert_eq!(snapshot.id, pushed.id),
        other => panic!("{other:?}"),
    }
    assert_eq!(
        fs::read_to_string(dir_b.path().join("note.md")).unwrap(),
        "line 1 from A\nline 2\nline 3\n"
    );
    assert_eq!(b.changed_files().unwrap(), 0);
    assert_eq!(b.ahead().unwrap(), 0);
}

#[test]
fn pull_merges_non_overlapping_edits() {
    let (_r, dir_a, a, dir_b, b) = two_devices();
    write(dir_a.path(), "note.md", "line 1 from A\nline 2\nline 3\n");
    write(dir_a.path(), "only-a.md", "a");
    a.snapshot(None).unwrap();
    a.push(&Credentials::default()).unwrap();
    write(dir_b.path(), "note.md", "line 1\nline 2\nline 3 from B\n");
    b.snapshot(None).unwrap();

    match b.pull(&Credentials::default(), "B").unwrap() {
        PullOutcome::Merged {
            conflict_copies, ..
        } => assert!(conflict_copies.is_empty()),
        other => panic!("{other:?}"),
    }
    assert_eq!(
        fs::read_to_string(dir_b.path().join("note.md")).unwrap(),
        "line 1 from A\nline 2\nline 3 from B\n"
    );
    assert!(dir_b.path().join("only-a.md").exists());
    assert_eq!(b.changed_files().unwrap(), 0);
    assert_eq!(b.ahead().unwrap(), 2);
    assert_eq!(b.push(&Credentials::default()).unwrap().ahead, 0);
}

#[test]
fn pull_turns_conflicts_into_copies() {
    let (_r, dir_a, a, dir_b, b) = two_devices();
    write(dir_a.path(), "note.md", "line 1 from A\nline 2\nline 3\n");
    a.snapshot(None).unwrap();
    a.push(&Credentials::default()).unwrap();
    write(dir_b.path(), "note.md", "line 1 from B\nline 2\nline 3\n");
    b.snapshot(None).unwrap();

    write(dir_b.path(), "dirty.md", "unsnapshotted");
    assert!(matches!(
        b.pull(&Credentials::default(), "A"),
        Err(SyncError::Dirty)
    ));
    fs::remove_file(dir_b.path().join("dirty.md")).unwrap();

    let (snapshot, copies) = match b.pull(&Credentials::default(), "Laptop A").unwrap() {
        PullOutcome::Merged {
            snapshot,
            conflict_copies,
        } => (snapshot, conflict_copies),
        other => panic!("{other:?}"),
    };
    let date = chrono::Local::now().format("%Y-%m-%d");
    let copy = format!("note (conflict Laptop A {date}).md");
    assert_eq!(copies, vec![copy.clone()]);
    assert!(
        snapshot.message.contains("1 conflict"),
        "{}",
        snapshot.message
    );
    assert_eq!(
        fs::read_to_string(dir_b.path().join("note.md")).unwrap(),
        "line 1 from B\nline 2\nline 3\n"
    );
    assert_eq!(
        fs::read_to_string(dir_b.path().join(&copy)).unwrap(),
        "line 1 from A\nline 2\nline 3\n"
    );
    assert_eq!(
        b.read_at(&copy, &snapshot.id).unwrap(),
        "line 1 from A\nline 2\nline 3\n"
    );
    assert_eq!(b.changed_files().unwrap(), 0);
    let repo = b.repo();
    assert!(!repo.index().unwrap().has_conflicts());
    assert_eq!(repo.state(), git2::RepositoryState::Clean);
}

#[test]
fn pull_keeps_edits_over_deletions() {
    let (_r, dir_a, a, dir_b, b) = two_devices();
    fs::remove_file(dir_a.path().join("note.md")).unwrap();
    a.snapshot(None).unwrap();
    a.push(&Credentials::default()).unwrap();
    write(dir_b.path(), "note.md", "edited on B\n");
    b.snapshot(None).unwrap();

    match b.pull(&Credentials::default(), "A").unwrap() {
        PullOutcome::Merged {
            conflict_copies, ..
        } => assert!(conflict_copies.is_empty()),
        other => panic!("{other:?}"),
    }
    assert_eq!(
        fs::read_to_string(dir_b.path().join("note.md")).unwrap(),
        "edited on B\n"
    );
    assert_eq!(b.changed_files().unwrap(), 0);
}
