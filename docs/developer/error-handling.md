# Error Handling

## Error boundary

`src/lib/components/ErrorBoundary.svelte` uses Svelte 5's `<svelte:boundary>`
to catch errors thrown during render and in effects.

It wraps only the main content area — never the titlebar or the global overlays
(palette, preferences, confirm dialog, toasts). This means the user always has
window controls and the command palette available, even when the content area
crashes.

On error:

1. Logs via `logger.error()`
2. Saves crash data to disk via `commands.saveEmergencyData()`
3. Writes a crash report via `commands.logFrontendError()` (see Crash reporting below)
4. Renders a fallback UI with "Copy details" and "Reload" buttons

The reload is a full `location.reload()`, not a soft `_reset()`. Re-running
`main.ts` re-hydrates from disk, recovering from more states than a
boundary reset.

Note: `<svelte:boundary>` does **not** catch errors thrown from event handlers.
Those need their own try/catch at the call site.

## Crash recovery

`save_emergency_data()` in `src-tauri/src/commands/recovery.rs` atomically
writes crash data to `<app-data-dir>/recovery/<filename>.json`. On startup,
`cleanup_old_recovery_files()` purges files older than 7 days. See
[Persistence & Recovery](persistence-and-recovery.md) for details.

## Crash reporting

`src-tauri/src/commands/crash_reporter.rs` provides automatic crash capture
at two levels:

**Rust panics** — `install_panic_hook()` is called as the very first line of
`run()`, before the Tauri Builder is constructed. It chains
`std::panic::take_hook()` and writes structured `.log` files to
`<app-data-dir>/crash-reports/` with message, location, backtrace, OS info,
and app version. Uses a `OnceLock<PathBuf>` for the crash directory, set via
`set_app_crash_dir()` in `setup()`, with a fallback to
`~/.app-crash-reports/` for panics that happen before setup completes.

**Frontend errors** — `log_frontend_error()` writes
`frontend-error-<timestamp>.log` to the same directory. Called from:

- `ErrorBoundary.svelte` on render crashes (alongside `saveEmergencyData`)
- `logger.ts` on all prod-level `error()` calls (via `forwardToCrashReporter`)

**Startup notification** — `checkForRecentCrash()` in `App.svelte` calls
`hasRecentCrash()` on boot. If a crash report exists within the last 300
seconds, a warning toast appears with a "Copy Report" action button.

**Management UI** — the Advanced preferences pane shows the crash report count
and a "Clear Crash Reports" button. The "Copy Diagnostics" button (see
Diagnostics below) also includes recent crash report filenames.

## Result discipline

All Rust commands return `Result<T, String>`. On the frontend, the generated
bindings produce a discriminated union:

```ts
{ status: 'ok', data: T } | { status: 'error', error: string }
```

`unwrapResult()` in `src/lib/tauri-bindings.ts` extracts the success value or
throws the error string. Every `commands.*` call goes through it.

## Frontend logging

`src/lib/logger.ts` provides a `Logger` singleton:

| Method | Dev behaviour | Prod behaviour |
| --- | --- | --- |
| `trace` / `debug` / `info` | Console with `[ISO-timestamp] [LEVEL]` prefix | Silent |
| `warn` / `error` | Console with prefix | Forwarded to `@tauri-apps/plugin-log` backend |
| `error` (additional) | — | Also writes a crash report via `logFrontendError` |

The plugin-log import is lazy (`import()`) so it doesn't add to the critical
path. Logging never throws — the `forwardToBackend` catch block is a silent
swallow.

Exports: `logger` singleton and destructured `trace`, `debug`, `info`, `warn`,
`error` convenience functions.

## Store load failures

Both `initPreferences()` and `initAppState()` catch load failures and fall back
to defaults. The app starts cleanly even if both files are missing, corrupt,
or unreadable. Corrupt files are renamed to `.corrupt-<unix_ts>` by
`load_json()` on the Rust side.

## Two-phase close

The app uses a two-phase close to ensure stores are flushed before exit:

1. **Rust** intercepts `CloseRequested` and calls `api.prevent_close()`
2. **Rust** emits `app:close-requested` with `{ hide: bool }` (`hide: true`
   only on macOS)
3. **Frontend** (`App.svelte`) listens, calls `confirmQuitIfDirty()` — if the
   dirty flag is set, shows a confirmation dialog; returns early on cancel
4. **Frontend** calls `flushAllStores()`
4. On macOS (`hide: true`): hides the window (app stays running in the dock)
5. On Windows/Linux (`hide: false`): calls `commands.quitApp()`, which exits
   the whole process rather than closing just the window — the hidden Quick
   Pane window would otherwise keep the process alive

`quitApp` sets the `force_close` atomic flag before `app.exit(0)` so the
window closes triggered by teardown pass through the `CloseRequested` handler
without being re-intercepted.

The quit path (`requestQuit()` in `lifecycle.ts`) works the same way: it
checks `confirmQuitIfDirty()`, flushes stores, then calls
`commands.quitApp()`. This is also the only way to actually exit on macOS,
where closing the window only hides it.

## Unsaved-changes gate

`src/lib/stores/dirty.svelte.ts` exposes `getHasUnsavedChanges()` and
`setHasUnsavedChanges(value)`. The flag mirrors to a Rust-side `AtomicBool`
on `AppState` (for potential native affordances like macOS's "edited" dot)
but the actual gate is frontend-owned: `confirmQuitIfDirty()` in
`lifecycle.ts` shows the in-app confirmation dialog when dirty and clears the
flag on accept. All three quit paths (window close, tray quit, command
palette) converge through this gate.

The Advanced preferences pane includes a "Simulate Unsaved Changes" toggle
for manual testing.

## Diagnostics

`src-tauri/src/commands/diagnostics.rs` provides `collect_diagnostics()`,
which bundles app name, version, OS, memory usage, uptime, sanitised
settings, and recent crash reports into a single `DiagnosticsReport`. The
`tauri_version` is passed from the frontend (no reliable Rust-side constant).

Settings are sanitised via an explicit allowlist (theme, language, fontSize,
reducedMotion, pointerCursors, windowEffects) — shortcuts, imported themes,
and profile colours are excluded.

The Advanced preferences pane has a "Copy Diagnostics" button that formats
the report as plain text (via `src/lib/diagnostics.ts`) and copies it to the
clipboard.

The tray menu's Quit follows the same discipline: `tray.rs` emits
`tray:quit-requested` (never `app.exit()` directly), and `App.svelte` routes
it into `requestQuit()`, so a tray quit flushes stores like any other quit.
