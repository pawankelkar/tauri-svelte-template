# Cross-Platform

## Platform detection

`@tauri-apps/plugin-os` provides runtime platform info. The template wraps it
in `src/lib/hooks/use-platform.svelte.ts`:

```ts
type AppPlatform = 'macos' | 'windows' | 'linux'

function getPlatform(): AppPlatform
```

The result is cached after the first call. On failure (e.g. in tests without a
Tauri runtime), it defaults to `'macos'`.

## Platform display strings (`src/lib/platform-strings.ts`)

A `PlatformStrings` interface provides platform-aware labels:

| Field | macOS | Windows | Linux |
| --- | --- | --- | --- |
| `revealInFileManager` | Reveal in Finder | Show in Explorer | Show in Files |
| `fileManagerName` | Finder | Explorer | Files |
| `modifierKey` | Command | Ctrl | Ctrl |
| `modifierSymbol` | ⌘ | Ctrl | Ctrl |
| `optionKey` | Option | Alt | Alt |
| `optionSymbol` | ⌥ | Alt | Alt |
| `preferencesLabel` | Settings… | Settings | Preferences |
| `quitLabel` | Quit | Exit | Quit |
| `trashName` | Trash | Recycle Bin | Trash |

`getPlatformStrings(platform)` returns the appropriate table.

### `formatShortcut(platform, key, modifiers)`

Formats a shortcut for display:

- macOS: symbols, no separators — `⇧⌘K`
- Windows/Linux: labels with `+` — `Ctrl+Shift+K`

Mac uses a specific modifier order (⌥ ⇧ ⌘) matching Apple's convention.

## Titlebar

`src/lib/components/layout/TitleBar.svelte` acts as a platform router:

- **macOS**: native traffic-light controls (left side), title centred
- **Windows**: custom control icons (minimise, maximise/restore, close) on the
  right, title left-aligned
- **Linux**: native decorations (`decorations: true` in platform config)

A `forcePlatform` dev prop overrides detection for local testing of other
platforms' variants.

## Platform-specific Tauri configs

`tauri.conf.json` is the base. Platform overrides use JSON merge patch:

- `tauri.macos.conf.json` — decorations on, traffic-light position
- `tauri.windows.conf.json` — decorations off (custom titlebar)
- `tauri.linux.conf.json` — decorations on (native)

JSON merge patch replaces arrays wholesale, so any override that touches an
array must include the complete array.

## Per-window capabilities

Capabilities are split by window label:

| File | Window | Grants |
| --- | --- | --- |
| `capabilities/default.json` | `main` | Full core + all plugin permissions |
| `capabilities/desktop.json` | `main` | `window-state:default`, `updater:default` |
| `capabilities/quick-pane.json` | `quick-pane` | Minimal: `core:default`, a few `core:window` permissions, `core:event` |

App-defined Rust commands are **not** capability-gated — only core and plugin
commands are. This is why the global-shortcut plugin needs no capability entry.

## Context menus (`src/lib/context-menu.ts`)

Native right-click menus via Tauri's `Menu`/`MenuItem`/`PredefinedMenuItem`:

| Function | Items |
| --- | --- |
| `showContextMenu(entries)` | Build an arbitrary menu from a declarative list |
| `showEditContextMenu()` | Cut, Copy, Paste, Select All |
| `showTextInputContextMenu()` | Undo, Redo, Cut, Copy, Paste, Select All |

`showTextInputContextMenu()` is wired to text inputs via a Svelte action. The
predefined items use OS-native labels — no i18n needed for them.

Types: `ContextMenuItem`, `ContextMenuSeparator`, `ContextMenuEntry`, with an
`isSeparator()` type guard.

## Tray icon (`src-tauri/src/tray.rs`)

A minimal tray icon, built entirely in Rust (no JS IPC, so no capability
entries). Left-click shows/focuses the main window; the menu offers Show and
Quit. Quit emits `tray:quit-requested`, which `App.svelte` routes through the
store-flushing quit path — see the two-phase close in `error-handling.md`.

The menu is OS-native, so its labels are static English (webview translations
don't reach native menus). On macOS `icon_as_template(true)` turns the colored
default icon into an auto-tinted silhouette; shipping apps should provide a
dedicated monochrome tray asset.

## Square corners

On macOS the OS rounds window corners. On Windows and Linux, fullscreen
windows should have square corners.

`src/lib/stores/square-corners.svelte.ts` exports `initSquareCorners()`:

- On macOS: no-op (OS handles it)
- On Windows/Linux: listens to `getCurrentWindow().onResized()`, checks
  `isFullscreen()`, and calls `setSquareCorners(true/false)`

`App.svelte` applies `.square-corners` to `<html>` via an `$effect`. The CSS
variable `--app-corner-radius` is `12px` by default and `0px` under
`.square-corners`. Layout components use `rounded-[var(--app-corner-radius)]`.
