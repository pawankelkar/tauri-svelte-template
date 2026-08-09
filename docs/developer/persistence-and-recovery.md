# Persistence & Recovery

## JSON store (`src-tauri/src/commands/json_store.rs`)

The foundation for all disk persistence. Three functions:

### `data_file_path(app, file_name)`

Resolves `<app-data-dir>/<file_name>`, creating the directory if needed.
All persistence goes through this so files land in the OS-standard location.

### `load_json<T: DeserializeOwned + Default>(path)`

Reads and parses a JSON file into `T`. On missing file, returns
`T::default()`. On corrupt JSON:

1. Renames the file to `<name>.corrupt-<unix_timestamp>`
2. Logs a warning
3. Returns `T::default()`

This means the app always starts, even with a hand-broken config file.

### `save_json<T: Serialize>(path, value)`

Atomic write: serialises to pretty JSON, writes to `<path>.json.tmp`, then
renames over the target. A crash mid-write leaves either the old file or the
temp file — never a half-written target.

## Preferences (`src-tauri/src/commands/preferences.rs`)

Three commands:

| Command | Purpose |
| --- | --- |
| `load_preferences` | Reads `preferences.json` via `load_json` |
| `save_preferences` | Validates theme, writes via `save_json` |
| `open_preferences_file` | Opens the JSON in the OS default editor (via `tauri-plugin-opener`) |

Two non-command helpers for startup:

- `load_global_shortcut(app)` — reads just the global shortcut field
  synchronously, because `setup()` runs before the async command path
- `load_quick_pane_shortcut(app)` — same, for the Quick Pane accelerator

## App state (`src-tauri/src/commands/app_state.rs`)

Same pattern on `state.json`: `load_app_state` and `save_app_state` commands.

## Crash recovery (`src-tauri/src/commands/recovery.rs`)

### `save_emergency_data(filename, data)`

Called by the `ErrorBoundary` when a component throws during render:

1. Validates the filename (no path separators, no dot prefix, 200-char max)
2. Serialises to JSON, enforces a 10 MB cap
3. Atomic writes to `<app-data-dir>/recovery/<filename>.json`

### `cleanup_old_recovery_files(app)`

Called once on startup. Walks `recovery/`, removes `.json` files older than
7 days. Non-fatal — a failure to clean up is logged but never blocks the app.

## Frontend integration

The `ErrorBoundary` (`src/lib/components/ErrorBoundary.svelte`) wraps only the
main content area — never the titlebar or global overlays. On error:

1. Logs via `logger.error()`
2. Calls `commands.saveEmergencyData()` with a timestamped filename
3. Renders a fallback UI with "Copy details" and "Reload" buttons

The fallback is a full page reload rather than a soft `_reset()`, because
re-running `main.ts` re-hydrates from disk, recovering from more states.
