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
3. Renders a fallback UI with "Copy details" and "Reload" buttons

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
3. **Frontend** (`App.svelte`) listens, calls `flushAllStores()`
4. On macOS (`hide: true`): hides the window (app stays running in the dock)
5. On Windows/Linux (`hide: false`): calls `commands.quitApp()`, which exits
   the whole process rather than closing just the window — the hidden Quick
   Pane window would otherwise keep the process alive

`quitApp` sets the `force_close` atomic flag before `app.exit(0)` so the
window closes triggered by teardown pass through the `CloseRequested` handler
without being re-intercepted.

The quit path (`requestQuit()` in `lifecycle.ts`) works the same way: it
flushes stores then calls `commands.quitApp()`. This is also the only way to
actually exit on macOS, where closing the window only hides it.

The tray menu's Quit follows the same discipline: `tray.rs` emits
`tray:quit-requested` (never `app.exit()` directly), and `App.svelte` routes
it into `requestQuit()`, so a tray quit flushes stores like any other quit.
