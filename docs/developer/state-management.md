# State Management

## Stores

All stores live in `src/lib/stores/` and follow the same pattern: module-level
`$state`, exported getter/setter functions, an `init*()` that loads from disk,
and a `__reset*ForTests()` for Vitest.

### Preferences (`preferences.svelte.ts`)

User settings persisted to `preferences.json` via the Rust `json_store`.

| Field | Type | Default |
| --- | --- | --- |
| `theme` | `'light' \| 'dark' \| 'system'` | `'system'` |
| `language` | `string \| null` | `null` |
| `globalShortcut` | `string \| null` | `null` |
| `quickPaneShortcut` | `string \| null` | `'CmdOrCtrl+Shift+.'` |

Key functions:

- `getPreferences()` — read the current in-memory value
- `setPreference(key, value)` — update + debounced save (500 ms)
- `setPreferenceImmediate(key, value)` — update + immediate save, throws on
  failure and rolls back the in-memory value (used by `commitShortcut`)
- `initPreferences()` — load from disk, sanitise, mark ready
- `persistPreferencesNow()` — flush the debounce timer (called on close)

### App state (`app-state.svelte.ts`)

UI layout state persisted to `state.json`.

| Field | Type | Default |
| --- | --- | --- |
| `leftSidebarVisible` | `boolean` | `true` |
| `rightSidebarVisible` | `boolean` | `true` |
| `squareCorners` | `boolean` | `false` |
| `lastQuickPaneEntry` | `string \| null` | `null` |
| `recentItems` | `string[]` | `[]` |
| `onboardingCompleted` | `boolean` | `false` |

Key functions mirror the preferences store: `getAppState()`,
`setAppStateField()`, `addRecentItem()`, `removeRecentItem()`,
`clearRecentItems()`, `completeOnboarding()`, `initAppState()`,
`persistAppStateNow()`.

Debounce delay: 800 ms.

### UI convenience (`ui.svelte.ts`)

Thin wrappers over `app-state` fields: `isLeftSidebarVisible()`,
`toggleLeftSidebar()`, `getLastQuickPaneEntry()`, etc. These exist so
components don't need to know about the app-state store directly.

### Dirty flag (`dirty.svelte.ts`)

A non-persisted boolean that tracks whether the app has unsaved changes. Resets
each launch.

- `getHasUnsavedChanges()` — read the flag
- `setHasUnsavedChanges(value)` — update + mirror to Rust (`AppState.has_unsaved_changes`)

The flag gates all quit paths via `confirmQuitIfDirty()` in `lifecycle.ts`,
which shows the in-app confirmation dialog when dirty. See
[Error Handling](error-handling.md) for the full close sequence.

### Theme (`theme.svelte.ts`)

Manages the light/dark/system mode. See [Theme System](theme-system.md).

## Schema validation

Each persisted store has a companion schema file:

- `preferences-schema.ts` — `defaultPreferences()`, `sanitizePreferences(raw)`
- `app-state-schema.ts` — `defaultAppState()`, `sanitizeAppState(raw)`

`sanitize*()` does per-field type checking with fallback to defaults. This
protects against corrupt or hand-edited JSON files. The Rust side also carries
matching defaults via `#[serde(default)]` on the structs in `types.rs`.

## Debounced persistence

`src/lib/utils/debounce-persist.ts` exports `createDebouncedPersist(saveFn, delayMs)`.

```ts
interface DebouncedPersist {
  schedule(): void   // restart the timer
  flush(): Promise<void>  // drain immediately (idempotent if nothing pending)
}
```

Both stores use this: preferences at 500 ms, app state at 800 ms. The timer is
a plain `setTimeout`; `flush()` cancels it and runs the save synchronously. An
in-flight save is awaited rather than duplicated.

## `$state.snapshot()` before IPC

Svelte 5 wraps `$state` values in reactive proxies. These proxies do not
serialise over Tauri's IPC bridge — `invoke()` silently sends `{}` instead of
the actual data. Every call that sends reactive state must wrap it:

```ts
unwrapResult(await commands.savePreferences($state.snapshot(_preferences)))
```

An ast-grep rule (`snapshot-before-ipc.yml`) catches violations at lint time.

## Flush-on-close

`src/lib/lifecycle.ts` exports `flushAllStores()`:

```ts
export function flushAllStores(): Promise<void> {
  return Promise.all([persistPreferencesNow(), persistAppStateNow()])
    .then(() => undefined)
}
```

Both exit paths use it, after the unsaved-changes gate:

1. **Close handshake** — Rust prevents the window close, emits
   `app:close-requested`; `App.svelte` calls `confirmQuitIfDirty()`, then
   `flushAllStores()`, then confirms
2. **Quit command** — `requestQuit()` in `lifecycle.ts` checks
   `confirmQuitIfDirty()`, flushes, then calls `commands.quitApp()`

Adding a new persisted store: export a `flush()`, call it from
`flushAllStores()`.

## Adding a new persisted field

1. Add the field to the Rust struct in `src-tauri/src/types.rs` (with
   `#[serde(default)]` so existing files still parse)
2. Regenerate bindings: `pnpm run rust:bindings`
3. Add the field to the TS schema's `default*()` and `sanitize*()` functions
4. Use it through the store's getter/setter
