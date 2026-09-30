# Commands & Shortcuts

## Command registry

Every user-triggerable action in the app is an `AppCommand` registered with the
central registry in `src/lib/commands/registry.svelte.ts`:

```ts
interface AppCommand {
  id: string
  labelKey: string          // i18n key for display in the palette and menus
  label?: () => string      // optional dynamic label (e.g. "Hide Left Sidebar")
  category: string          // i18n key for palette grouping
  shortcut?: string         // default combo, e.g. 'mod+shift+p' (user-rebindable)
  run: (args?: unknown) => void | Promise<void>
  when?: string             // context-key expression gating the shortcut
  allowInInput?: boolean    // fire even while a text field has focus
  args?: unknown            // default argument passed to run()
  docs?: string             // documentation URL
  descriptionKey?: string   // i18n key for a one-line description
  keywords?: string[]       // extra palette search terms
  source?: 'core' | 'plugin' | 'user'   // defaults to 'core' on registration
  icon?: Component          // shown in the palette
  isEnabled?: () => boolean // disabled commands run from no surface
  platforms?: Array<'macos' | 'windows' | 'linux'>  // omitted = everywhere
}
```

Register with `registerCommand(cmd)` or `registerCommands(cmds)`. Look up with
`getCommand(id)` or `listCommands()`. Execute with `executeCommand(id, args?)`
— `args` overrides the command's own `args`; disabled or platform-hidden
commands are skipped.

Commands whose `platforms` exclude the current OS (`isCommandVisible()`) are
hidden from the palette, the Shortcuts pane, conflict checks, and keyboard
resolution. `isEnabled()` returning `false` greys the command out in the
palette and removes it from keyboard resolution.

## Context keys and `when`

`src/lib/commands/context-keys.svelte.ts` holds a reactive map of *context
keys* — facts like "the editor has focus" or "a recording is running":

| Function | Purpose |
| --- | --- |
| `setContextKey(key, value)` | Set a key (any value; truthiness is what bare keys test) |
| `getContextKey(key)` | Read a key (`undefined` if never set) |
| `evaluateWhen(expr)` | Evaluate an expression; empty/`undefined` → `true` |
| `parseWhen(expr)` | Parse to an AST (throws on malformed input) |
| `resetContextKeys()` | Clear everything (tests) |

Well-known keys: `editorFocus`, `editorTextFocus`, `canvasFocus`,
`notebookFocus`, `pdfFocus`, `chatFocus`, `paletteOpen` (kept in sync by
`palette-state.svelte.ts`), `meetingActive`, `recording`, `isMac` (set by
`initCommands()`), `offline`, `pro`. The module that owns a fact sets its key;
unknown keys read as falsy.

**Expression grammar**, highest precedence first:

| Syntax | Meaning |
| --- | --- |
| `key` | truthiness of the key; `true` / `false` are constants |
| `(expr)` | grouping |
| `!expr` | negation |
| `key == literal`, `key != literal` | strict comparison; literal is `'single-quoted'`, a number, or `true`/`false` |
| `a && b` | and |
| `a \|\| b` | or |

The left side of `==`/`!=` must be a bare key (`!a == 'x'` is a parse error).
A malformed expression evaluates to `false` and logs one warning per distinct
expression; parsed ASTs are cached.

`when` scopes the **keyboard binding** only. The palette ignores it — opening
the palette moves focus, so focus-scoped commands would otherwise disappear
exactly when the user looks for them. Use `isEnabled` to stop a command
running at all.

## Unified dispatch

Three input sources, one code path:

| Source | How it reaches `executeCommand()` |
| --- | --- |
| **Keyboard** | `createKeydownHandler()` resolves the combo via `resolveShortcut()` |
| **Command palette** | `CommandPalette.svelte` calls `executeCommand()` on select |
| **Native menu** | `menu.ts` wires each `MenuItem`'s `action` to `executeCommand()` |

No command body is duplicated.

## Command modules

Commands are organised into modules under `src/lib/commands/`:

| Module | Commands |
| --- | --- |
| `app-commands.ts` | `open-command-palette`, `toggle-theme`, `open-preferences`, `toggle-left-sidebar`, `toggle-right-sidebar`, `toggle-quick-pane`, `app-quit` |
| `tab-commands.ts` | `tab.close`, `tab.closeOthers`, `tab.next`, `tab.prev`, `tab.reopenClosed`, `tab.togglePin` (see [Workspace](workspace.md#tab-commands)) |
| `note-commands.ts` | `note.new`, `note.quickOpen`, `note.save`, `note.rename`, `note.trash`, `search.find`, `search.vault`, `nav.back`, `nav.forward`, `editor.bold`, `editor.italic` |
| `vault-commands.ts` | `vault.open`, `vault.create`, `vault.switch`, `vault.close`, `vault.reindex`, `backup.now`, `backup.init` |

### Default keymap

| Command | Default | Notes |
| --- | --- | --- |
| `open-command-palette` | `mod+shift+p` | `allowInInput: true` — reachable from any text field |
| `open-preferences` | `mod+,` | |
| `toggle-left-sidebar` | `mod+\` | |
| `toggle-right-sidebar` | `mod+alt+\` | |
| `tab.close` | `mod+w` | not OS-reserved, so this default is always accepted |
| `tab.next` / `tab.prev` | `mod+alt+arrowright` / `mod+alt+arrowleft` | |
| `tab.reopenClosed` | `mod+shift+t` | |
| `note.new` | `mod+n` | scoped by `isEnabled: hasVault`, not `when`, so the File menu shows the accelerator |
| `note.quickOpen` | `mod+o` | same as `note.new` |
| `note.save` | `mod+s` | saves the active note now (autosave runs anyway) |
| `note.rename` | `f2` | `when: vaultOpen`; renames the tree selection while the tree has focus (`fileTreeFocus`), else the active note's title |
| `search.find` | `mod+f` | `when: vaultOpen`; CodeMirror's find panel in a note, the vault search elsewhere |
| `search.vault` | `mod+shift+f` | `when: vaultOpen`; seeds the query with a single-line selection |
| `nav.back` / `nav.forward` | `mod+[` / `mod+]` | enabled by the history store |
| `editor.bold` / `editor.italic` | `mod+b` / `mod+i` | `when: editorTextFocus`, so the chords stay free everywhere else |
| `backup.now` | `mod+alt+b` | `when: vaultOpen`; saves open notes, then snapshots |

`mod+k` is deliberately left free: it is the link chord in every rich-text
surface. `mod+b` / `mod+i` are only bound inside the note editor.

`note-commands.test.ts` asserts that no two built-in defaults are a blocking
conflict (`findShortcutConflict`), so a new default that collides fails CI.

### Inside the note editor

CodeMirror ships its own bindings on chords the app owns (`Mod-f`, `Mod-i`,
`Mod-[`…). `src/lib/editor/keymap.ts` keeps the app keymap authoritative: a
highest-precedence keydown handler resolves every chord through the registry
and runs commands marked `allowInInput` (then `preventDefault`s, so the
window-level dispatcher does not run them again), and `BLOCKED_EDITOR_KEYS`
removes the CodeMirror bindings that would shadow a default app chord.
Rebinding a command therefore works inside the editor too.

### Keymap migration

`keymap-migration.ts`'s `runKeymapMigration()` (called from `initCommands()`,
after preferences are loaded) checks `prefsVersion`. Files written before
versioning load as `0`; if the palette still uses its default binding the user
gets a one-time toast (`keymap.migration.paletteMoved`) naming the new combo,
then `prefsVersion` is stamped to `1`. Overrides in `commandShortcuts` are
keyed by command id, so they survive untouched. Fresh installs start at `1`
and never see the toast. Bump `CURRENT_PREFS_VERSION` and extend the function
the next time a default binding moves.

## `initCommands()`

`src/lib/commands/index.ts` exports `initCommands()`, called from
`App.svelte`'s boot sequence. It:

1. Sets the `isMac` context key
2. Registers all command modules
3. Points the registry's shortcut-override resolver at the persisted
   `commandShortcuts` preference (`initCommandShortcutOverrides()`)
4. Runs the one-time keymap migration (`runKeymapMigration()`)
5. Creates a `keydown` handler via `createKeydownHandler(resolveShortcut, …)`
6. Initialises the native menu bar via `initMenu()`

Returns a cleanup function that removes the keydown listener and the menu's
`languageChanged` subscription.

## Command palette

`CommandPalette.svelte` uses the shadcn-svelte `Command` component. State
(open/closed) lives in `palette-state.svelte.ts`, which mirrors it into the
`paletteOpen` context key. The palette lists every platform-visible command,
fuzzy-filters by label and `keywords`, shows `icon`, and disables commands
whose `isEnabled()` is false.

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
5. Optionally add a `shortcut` (normalised, e.g. `'mod+shift+n'`), a `when`
   to scope it, and `allowInInput: true` if it must fire from text fields
6. Optionally add a menu entry in `menu.ts` via `commandItem(MY_COMMAND_ID)`.
   Only commands **without** a `when` get a native accelerator — the OS fires
   menu accelerators regardless of focus, which would bypass the scope. A
   scoped command's menu item still works, it just shows no shortcut.

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
| `buildCombo(event)` | `KeyboardEvent` → `'mod+shift+k'`; reads the physical key when macOS Option composes a character (`⌥⌘\` → `'mod+alt+\'`), and spells the space bar `space` |
| `toTauriAccelerator(normalized)` | `'mod+shift+k'` → `'CmdOrCtrl+Shift+K'` (for OS registration) |
| `fromTauriAccelerator(accelerator)` | Inverse of the above (for display) |
| `isValidGlobalShortcutCombo(combo)` | Requires at least one modifier + a key |

**Keydown handler:**

```ts
createKeydownHandler(
  resolveCommand: (combo: string) => { id: string; allowInInput?: boolean } | undefined,
  dispatch: (commandId: string) => void,
): (event: KeyboardEvent) => void
```

`initCommands()` passes the registry's `resolveShortcut(combo)`, which picks
among visible, enabled commands bound to the combo whose `when` holds, ranked
by: user override > more specific `when` (more terms beats fewer, any beats
none) > `source` (`user` > `plugin` > `core`) > registration order.

When focus is in an editable target (`<input>`, `<textarea>`,
`contentEditable`) the resolved command only fires if it sets
`allowInInput: true`; otherwise the keystroke is left for the field.
A keydown something closer to the target already consumed
(`defaultPrevented` — a dialog, a list, the editor) is skipped. The one
exception is the browser-accelerator and reload suppressor
(`browser-keys.ts`): it cancels Cmd/Ctrl+F, G and P in the capture phase to
keep the webview's find bar and print dialog away, and records the events it
cancelled (`wasSuppressedBrowserKey`) so that `mod+f`, `mod+shift+f` and
`mod+shift+p` still reach their commands.

### Rebindable in-app shortcuts

A command's `shortcut` is only its *default*. The user can rebind or unbind
any command from the Shortcuts pane in Preferences; overrides persist in the
`commandShortcuts` preference (`Record<commandId, combo | null>` — `null`
means explicitly unbound, a missing key means default).

`src/lib/commands/command-shortcuts.ts` owns the feature:

| Function | Purpose |
| --- | --- |
| `initCommandShortcutOverrides()` | Wires the registry to the preference (called by `initCommands()`) |
| `setCommandShortcut(id, combo \| null)` | Rebind/unbind; storing a command's default removes the override |
| `resetCommandShortcut(id)` | Back to the default |
| `isShortcutCustomized(id)` | Drives the reset affordance in the UI |
| `findShortcutConflict(combo, excludeId)` | Classifies a clash (below), or `null` |
| `isBlockingConflict(conflict)` | `false` only for `warning` |
| `isReservedShortcut(combo)` | Whether the combo is on the OS-reserved list |

`findShortcutConflict` returns a `ShortcutConflict`:

| Result | When | UI |
| --- | --- | --- |
| `{ kind: 'reserved', reason: 'os' }` | `mod+q`, `mod+h`, `mod+m`, `mod+tab`, `mod+space`, `alt+f4` (never applied to a command's own built-in default) | blocked |
| `{ kind: 'reserved', reason: 'global', purpose }` | one of the app's own global shortcuts | blocked |
| `{ kind: 'conflict', commandId }` | same combo, and either side has no `when` or both are identical | blocked |
| `{ kind: 'warning', commandId }` | same combo under a different non-empty `when` | saved, with an inline note |

The Shortcuts pane stays in recording mode on a blocking result and saves
through a warning, leaving the note under the row. The global
`ShortcutPicker` refuses OS-reserved combos the same way.

Everything that displays or dispatches a shortcut goes through
`getEffectiveShortcut(command)` on the registry (palette, native menu,
keydown resolver, Shortcuts pane), so a rebind takes effect everywhere at
once; `setCommandShortcut` also calls `rebuildMenu()` because native menu
accelerator text is static once built.

To **show** a binding, use the helpers in
`src/lib/commands/shortcut-display.ts` (exported from `$lib/commands`) rather
than hardcoding a combo:

- `formatCommandShortcut(commandId)` — the command's effective binding
  formatted for the current platform, or `null` when the user unbound it.
  Onboarding, the empty workspace, the palette and the Shortcuts pane use it.
- `formatCombo(combo)` — formats any normalised combo (`mod+alt+arrowright`
  → `⌥⌘→` on macOS, `Ctrl+Alt+Right` elsewhere).

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
