# Commands & Shortcuts

## Command registry

Every user-triggerable action in the app is an `AppCommand` registered with the
central registry in `src/lib/commands/registry.svelte.ts`:

```ts
interface AppCommand {
  id: string
  labelKey: string        // i18n key for display in the palette and menus
  label?: () => string    // optional dynamic label (e.g. "Hide Left Sidebar")
  category: string        // i18n key for palette grouping
  shortcut?: string       // normalised combo, e.g. 'mod+k'
  run: () => void | Promise<void>
}
```

Register with `registerCommand(cmd)` or `registerCommands(cmds)`. Look up with
`getCommand(id)` or `listCommands()`. Execute with `executeCommand(id)`.

## Unified dispatch

Three input sources, one code path:

| Source | How it reaches `executeCommand()` |
| --- | --- |
| **Keyboard** | `createKeydownHandler()` resolves the combo to a command id |
| **Command palette** | `CommandPalette.svelte` calls `executeCommand()` on select |
| **Native menu** | `menu.ts` wires each `MenuItem`'s `action` to `executeCommand()` |

No command body is duplicated.

## Command modules

Commands are organised into modules under `src/lib/commands/`:

| Module | Commands |
| --- | --- |
| `app-commands.ts` | `open-command-palette`, `toggle-theme`, `open-preferences`, `toggle-left-sidebar`, `toggle-right-sidebar`, `toggle-quick-pane`, `app-quit` |
| `notification-commands.ts` | `demo-send-notification` |
| `clipboard-commands.ts` | `demo-copy-to-clipboard`, `demo-paste-from-clipboard` |
| `dialog-commands.ts` | `demo-open-file-dialog` |
| `shell-commands.ts` | `demo-run-shell-command` |
| `process-commands.ts` | `demo-relaunch-app` (via confirm dialog) |

Demo modules exist so the plugins they exercise ship with a working example.
Delete them when you start building your own app.

## `initCommands()`

`src/lib/commands/index.ts` exports `initCommands()`, called from
`App.svelte`'s boot sequence. It:

1. Registers all command modules
2. Creates a `keydown` handler via `createKeydownHandler(['mod+k'], ...)`
3. Initialises the native menu bar via `initMenu()`

Returns a cleanup function that removes the keydown listener and the menu's
`languageChanged` subscription.

## Command palette

`CommandPalette.svelte` uses the shadcn-svelte `Command` component. State
(open/closed) lives in `palette-state.svelte.ts`. The palette lists all
registered commands and fuzzy-filters by label.

## Preferences dialog

`PreferencesDialog.svelte` state lives in
`preferences-dialog-state.svelte.ts`: `openPreferencesDialog()`,
`closePreferencesDialog()`, `getActivePreferencesPane()`.

## Adding a new command

1. Create a module in `src/lib/commands/` (e.g. `my-commands.ts`)
2. Define commands with `AppCommand` — give each a unique `id` and an i18n
   `labelKey`
3. Export a `registerMyCommands()` function
4. Call it from `initCommands()` in `index.ts`
5. Optionally add a `shortcut` (normalised, e.g. `'mod+shift+n'`)
6. Optionally add a menu entry in `menu.ts` via `commandItem(MY_COMMAND_ID)`

---

## Shortcuts

### Shortcut module (`src/lib/shortcuts.ts`)

The shortcuts module is framework-agnostic — it parses, normalises, and
dispatches shortcut combos without touching the DOM or any store.

**Core types:**

```ts
type ShortcutModifier = 'mod' | 'shift' | 'alt'

interface ParsedShortcut {
  key: string
  modifiers: ShortcutModifier[]
}
```

`mod` maps to Cmd on macOS, Ctrl on Windows/Linux.

**Key functions:**

| Function | Purpose |
| --- | --- |
| `normalizeShortcut(raw)` | `'Ctrl+Shift+K'` → `'mod+shift+k'` |
| `parseShortcut(normalized)` | `'mod+shift+k'` → `{ key: 'k', modifiers: ['mod', 'shift'] }` |
| `buildCombo(event)` | `KeyboardEvent` → `'mod+shift+k'` |
| `toTauriAccelerator(normalized)` | `'mod+shift+k'` → `'CmdOrCtrl+Shift+K'` (for OS registration) |
| `fromTauriAccelerator(accelerator)` | Inverse of the above (for display) |
| `isValidGlobalShortcutCombo(combo)` | Requires at least one modifier + a key |

**Keydown handler:**

```ts
createKeydownHandler(
  inputAllowlist: string[],     // combos that fire even in text inputs
  resolveCommandId: (combo: string) => string | undefined,
  dispatch: (commandId: string) => void,
): (event: KeyboardEvent) => void
```

The handler skips editable targets (`<input>`, `<textarea>`,
`contentEditable`) unless the combo is in the allowlist. This prevents
shortcuts from swallowing user typing.

### Global shortcuts

Global shortcuts work even when the app is not focused. They are registered
with the OS via `tauri-plugin-global-shortcut`.

**Rust side** (`src-tauri/src/commands/global_shortcut.rs`):

A purpose-keyed registry:

```rust
static SHORTCUTS: LazyLock<Mutex<HashMap<ShortcutPurpose, String>>>
```

`ShortcutPurpose` is a specta-typed enum (`focusMain` | `quickPane`). The
plugin installs a single handler for all registered accelerators; it dispatches
by comparing parsed `Shortcut` values rather than raw strings.

Commands: `register_global_shortcut(purpose, accelerator)`,
`unregister_global_shortcut(purpose)`, `is_global_shortcut_registered(purpose)`.

On startup, `register_saved_shortcuts_on_startup()` reads the preferences file
directly (before the async path is usable) and registers whatever is saved.

**Frontend side** (`src/lib/components/preferences/commit-shortcut.ts`):

`commitShortcut(id, next)` handles the register-then-persist sequence with
full rollback:

1. Unregister the old accelerator (if any)
2. Register the new one — on failure, re-register the old and return an error
3. Persist to preferences — on failure, undo the registration and return an error

The `PURPOSES` table maps each `ShortcutPurposeId` to its Rust purpose and
its preferences key.

**ShortcutPicker component:**

A recording-mode input in the Preferences dialog. Click to start recording,
press a combo, the component commits it via `commitShortcut()`. Clear button
unregisters and saves `null`. Error toasts on registration or save failure.

### Adding a third global shortcut

1. Add a variant to `ShortcutPurpose` in `src-tauri/src/types.rs`
2. Add a handler arm in `global_shortcut.rs`'s dispatch function
3. Add the preference field to `AppPreferences` (Rust + TS)
4. Add an entry to the `PURPOSES` table in `commit-shortcut.ts`
5. Add a `ShortcutPicker` in the Preferences dialog

No new command, no new picker component — the existing ones are parameterised
by purpose.
