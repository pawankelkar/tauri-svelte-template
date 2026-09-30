# Vault, Index and Backup

How Ostralith opens a folder of Markdown notes, keeps a searchable cache of
it, watches it for outside edits and backs it up with git. The frontend only
sees the typed commands in `src-tauri/src/commands/{vault,search,db,backup}.rs`
(see `.claude/p1/contract.md` for the IPC contract); everything below is Rust.

## Architecture

```
commands/{vault,search,db,backup}.rs   thin #[tauri::command] wrappers
        │  State<VaultRuntime> + spawn_blocking
        ▼
vault_runtime/                          app crate, no Tauri dependency except TauriSink
  mod.rs        VaultRuntime: registry (vaults.json) + the one open vault
  open_vault.rs OpenVault: note commands, indexing primitives, link re-resolution
  worker.rs     per-vault background thread: sync, relink, watcher batches
  backup.rs     git backup commands on OpenVault
  registry.rs   vaults.json + encryption detection
  convert.rs    crate types → IPC types
        │
        ▼
crates/vault   ostralith-vault  files, parsing, link resolution/rewriting, watcher
crates/store   ostralith-store  SQLite/SQLCipher cache: notes, links, headings, tags, tasks
crates/index   ostralith-index  tantivy full-text index + quick-open ranking
crates/sync    ostralith-sync   git snapshots, history, restore, push
crates/net     ostralith-net    the only network client; policy + activity log
```

The files in the vault are the source of truth. The SQLite database and the
tantivy index are caches: both can be deleted at any time and are rebuilt
from the folder.

### State and threads

- `VaultRuntime` is managed Tauri state (`Clone`, an `Arc` inside). It holds
  at most one open vault. `open_lock` serialises open/create/close/forget;
  opening a vault closes the previous one first (the tantivy writer lock is
  per index directory, so a reopen needs it released).
- `OpenVault` (an `Arc`) owns the `Vault`, the `Db`, the `SearchIndex`, an
  in-memory note cache (path → title, mtime, hash; feeds quick-open and link
  resolution without DB round-trips), the watcher, the worker and the
  optional `GitBackup` (behind a `Mutex`: it is `Send` but not `Sync`).
- `index_lock` serialises every mutation of DB + search + cache. Commands
  (`write_note`, `rename_path`, …) hold it for the whole operation; the
  worker takes it per note during a sync, so a long initial index never
  blocks a save for more than one note.
- Commands run on Tauri's blocking pool (`vault_runtime::blocking`). The
  worker is one `std::thread` per open vault that processes a job queue in
  order: `Sync { full }`, `Relink`, `FsChanges(batch)`. It holds only a
  `Weak` between jobs; closing the vault cancels it, drops the queue and
  joins it, then commits the index.
- Events go through the `EventSink` trait (`TauriSink` in the app, a recorder
  in tests): `vault://current-changed`, `vault://fs-changed` (external
  changes only), `index://status`. Nothing is emitted during `setup`, and the
  app never opens a vault on its own: the frontend calls `vault_open_by_id`
  with its last vault id.
- On `RunEvent::Exit` the runtime shuts down without emitting (the webview may
  be gone).

## Data directories

| Where | What |
| --- | --- |
| `<vault>/` | the user's notes and attachments |
| `<vault>/.ostralith/vault.json` | the vault's stable id (created on first open) |
| `<vault>/.trash/` | trashed files and folders (never deleted by the app) |
| `<vault>/.git/`, `<vault>/.gitignore` | only after `backup_init` |
| `$APPDATA/vaults.json` | the registry: every opened vault, `lastOpenedAt`, encryption |
| `$APPDATA/vaults/<id>/index.db` (+ `-wal`, `-shm`) | SQLite cache |
| `$APPDATA/vaults/<id>/search/` | tantivy index |
| `$APPDATA/dev-keys/vault-db-<id>.key` | debug builds only: DB keys |

`$APPDATA` is Tauri's `app_data_dir()`, e.g.
`~/Library/Application Support/com.ostralith.app` on macOS. Nothing in the
vault folder depends on it: a vault opened on a new machine just gets indexed
again.

`vault_forget` removes the registry entry only. It never deletes the vault,
its cache or its key.

## Encryption and keys

`vault_create` takes `DbEncryption::{None, Keychain}`. `Keychain` makes
`index.db` a SQLCipher database with a random 32-byte key per vault. Only
the cache is encrypted; the notes stay plain Markdown (they are the user's
files).

- Release builds keep the key in the OS credential store: service
  `com.ostralith.app`, account `vault-db:<vault id>`.
- Debug builds use `KeyStore::File($APPDATA/dev-keys)`. Every unsigned
  rebuild is a "new" app to the macOS keychain and would prompt on each
  launch. The file key is written `0600` and logged at startup. **Debug file
  keys are not a security boundary.** `KeyStore::for_build` picks the store.
- A vault's encryption is taken from the registry. When there is no entry
  (e.g. `vaults.json` was deleted), it is detected from the file header: a
  plaintext SQLite file starts with `SQLite format 3\0`, a SQLCipher file
  doesn't.
- If the key is missing or wrong (`WrongKey`), or a plain file is opened as
  encrypted (`NotEncrypted`), the cache is moved aside to
  `index.db.mismatch-<ms>` and rebuilt. It is a cache, so a lost key costs a
  reindex, never notes.

## Indexing pipeline

On open:

1. `Db::open_or_recover`: a corrupt file, a failed integrity check or a
   newer schema is moved to `index.db.corrupt-<ms>` and replaced.
2. The search index opens (retrying for up to 3 s while a previous
   instance's writer lock is released). `needs_rebuild` (schema change) or a
   fresh DB means a **full** sync; otherwise an **incremental** one.
3. The note cache is loaded from the DB, the watcher starts, and
   `Job::Sync` is queued. `vault_open_*` returns right away; progress arrives
   as `index://status` (at most every 200 ms or 100 notes) and via
   `index_status`.

A sync walks every note (`*.md`, hidden paths skipped) in path order:

- Notes whose mtime equals the DB's are skipped (incremental only).
- Otherwise the file is read and parsed once (`parse_note`: frontmatter,
  title, headings, links, tags, tasks). The DB gets the note row and all
  its links/headings/tags/tasks; tantivy gets title, headings, tags, path
  and the body with the frontmatter stripped. The cache gets title, mtime and
  hash. The search index commits every 200 notes and at the end.
- DB rows whose file is gone are dropped (re-checked on disk under
  `index_lock`, since a command may have created the note after the walk).
- After an incremental sync that changed anything, every link is
  re-resolved (see below).

Commands update the cache synchronously, inside `index_lock`, before they
return: `write_note`, `create_note` and `note_restore` reindex the note and
commit the search index; `rename_path` and `trash_path` move or drop rows
(folders by prefix). So a search right after a save sees the new text.

`reindex` queues a full sync: it clears the DB, the search index and the
cache, then indexes everything again.

## Link resolution

Each stored link keeps its raw target and a resolved `target_path` (NULL
when it points nowhere). Backlinks are a query on `target_path`.

Rules (Obsidian semantics, `ostralith_vault::links`):

- Wikilinks `[[target#heading|alias]]` (and `![[…]]` embeds): the heading,
  block and alias parts are ignored for resolution.
  1. exact vault path, with or without `.md`;
  2. relative to the linking note's folder;
  3. file name, case-insensitive; a target with `/` matches as a path
     suffix. Several matches: shortest path wins, then lexicographic order.
  At each step exact-case matches win over case-insensitive ones.
- Markdown links `[text](dest)` (URL-decoded): relative to the note's
  folder, then vault-absolute, then the file-name fallback. External URLs
  are not links.
- Same-note links (`[[#Heading]]`) resolve to the note itself; empty targets
  are not stored.
- `resolve_link` (for clicks) uses the same rules. A target with a non-`.md`
  extension that exists on disk (relative to the note, or vault-absolute) is
  `exists: true`. Anything unresolved returns `<target>.md` with
  `exists: false`, which is where a click creates the note.

### Re-resolution

Whether a link resolves depends on the whole note set, so adding, removing
or renaming a note can change links in *other* notes:

- A new note (created, written, or appearing externally) re-resolves the
  **unresolved** links synchronously, so `[[Future]]` backlinks show up as
  soon as `Future.md` exists. It then queues a full re-resolution.
- A removed note clears `target_path` for links to it.
- Renames and external batches that change the note set re-resolve.
- **Everything is re-resolved in the background** (`Job::Relink`, coalesced:
  at most one queued at a time) because a new note can also *steal* a link
  (a shorter path matching the same name). The pass is a single
  transaction and only updates rows whose resolution actually changed.

### Rename

`rename_path` uses `rename_with_links`: it moves the file or folder and
rewrites every wikilink and markdown link that pointed into it, plus relative
markdown links inside the moved notes. Files that changed on disk mid-way are
skipped and logged, not clobbered. The DB rows are moved (so backlinks
follow), then the moved notes and every rewritten note
(`RenameReport.updated_paths`) are reindexed.

## Watcher and own-write suppression

`VaultWatcher` (notify, 250 ms debounce) reports external changes only.
Hidden paths (`.ostralith/`, `.git/`, `.trash/`, dotfiles, `write_atomic`
temp files, `.icloud` placeholders) are ignored.

Every write, rename and trash done through `VaultFs` is recorded in a
shared `RecentWrites` set for 5 s with what the path should now look like
(a file with this blake3 hash, a directory, or nothing). The watcher drops
events matching such a record, so the app's own saves never come back as
`vault://fs-changed` and never trigger a second index pass. An external
edit within those 5 s still gets through, because its hash differs.

Batches are queued as `Job::FsChanges` and applied by the worker
(`OpenVault::handle_fs_changes`): removals unindex (folders by prefix),
creations and modifications reindex if the hash changed, renames are a
removal plus a creation, and a "removed" path that exists again is treated
as present. The batch is then forwarded to the frontend.

## Search syntax

`search_fulltext` (tantivy, BM25; title ×3, headings ×2, body):

| Syntax | Meaning |
| --- | --- |
| `word word` | every word must match |
| `"a phrase"` | adjacent, in order (an unclosed quote runs to the end) |
| `tag:foo`, `#foo` | tagged `foo` or a nested `foo/…` |
| `path:Projects/`, `path:"My Folder/"` | path prefix, case-insensitive |
| `-word`, `-tag:x`, `-path:x`, `NOT word` | exclusion |
| `a OR b` | alternatives (`AND` is accepted and ignored; no grouping) |

The last word matches as a prefix while typing (no trailing space). Any
input parses; malformed syntax degrades to plain words, never an error.
Results carry highlighted snippets as `TextPart[]`.

`quick_open` ranks the cached note titles and paths in memory
(`ostralith_index::quick_open::rank`), with no search-index round-trip.

## Git backup and the network policy

Git backup is opt-in per vault (`backup_init`). It creates a repository in
the vault with a `.gitignore` for `.ostralith/cache/` and `.trash/` (so
`.ostralith/vault.json` travels with the backup), author
`Ostralith <ostralith@localhost>`.

- `backup_now` commits every change (`None` if there was nothing to commit).
- `note_history` lists the snapshots that touched a note, and
  `note_restore` brings a note back from one. The current state is
  snapshotted first, and the restore is an ordinary reindexed write.
- `backup_set_remote` sets or clears `origin`.

**Pushing is the only network access here**, and it goes through the
network policy:

1. After the commit, if a remote is set and there is something to push,
   `ostralith_sync::authorization_url(remote)` maps it to an `https://host/…`
   URL with the user info stripped (`git@host:x` → `https://host/x`). Local
   remotes (`file://`, plain paths) return `None` and need no check.
2. For `Some(url)` the command calls
   `NetClient::authorize_external("POST", url, "git-backup")`. This checks
   offline mode and the host policy and records the request in the network
   activity log. On `Err` nothing is pushed and the `CoreError` (e.g.
   `Offline`) is returned. The snapshot stays committed and is pushed next
   time.
3. Then `git push` runs with `Credentials::ssh_agent()`. No credentials are
   stored or entered by the app.

`vault_runtime::backup` never calls the network itself. It receives the
authorization as a closure, which the tests replace.

## Resetting and rebuilding

| Symptom | Do |
| --- | --- |
| Search or backlinks look wrong | `reindex` (command palette), or delete `$APPDATA/vaults/<id>/` with the app closed |
| `index.db` corrupt | nothing: it is quarantined as `.corrupt-<ms>` and rebuilt on open |
| Lost or wrong DB key | nothing: moved aside as `.mismatch-<ms>` and rebuilt |
| Registry lost | reopen the folder (`vault_open_path`); the id comes from `.ostralith/vault.json` |
| Vault list entry for a moved folder | open the new location; the same id replaces the old entry |
| Debug keys | `$APPDATA/dev-keys/`; deleting one only forces a rebuild of that vault's cache |

The `*.corrupt-*` and `*.mismatch-*` files are kept for debugging and can be
deleted by hand. Never delete `<vault>/.ostralith/vault.json` unless you
want the vault to get a new id (and a new cache).

## Tests

`src-tauri/src/vault_runtime/tests.rs` covers the whole lifecycle without a
Tauri runtime: a scratch app data dir, `KeyStore::File` and a recording
`EventSink`. `OpenVault::flush()` (test-only) waits for the worker's queue.
External changes are applied by calling `handle_fs_changes` directly, so the
tests don't depend on watcher timing.
