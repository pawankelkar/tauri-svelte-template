# Using This Template

## Getting started

Clone or use GitHub's "Use this template" button:

```bash
# Option 1: GitHub template
# Click "Use this template" on the repo page

# Option 2: degit (no git history)
npx degit frostybee/tauri-svelte-template my-app

# Option 3: clone
git clone https://github.com/frostybee/tauri-svelte-template my-app
cd my-app && rm -rf .git && git init
```

Install dependencies and start developing:

```bash
pnpm install
pnpm tauri dev
```

## Renaming the app

If you use Claude Code, run the `/setup` skill — it replaces the app name,
bundle identifier, and updater placeholders across all config files.

Otherwise, search and replace these values manually:

| Placeholder | Files | Replace with |
| --- | --- | --- |
| `tauri-app` | `package.json`, `tauri.conf.json`, `Cargo.toml` | Your app name |
| `com.tauri-app.app` | `tauri.conf.json` | Your bundle identifier |
| `Tauri App` | `locales/en.json` (`app.name`, `titlebar.default`) | Your display name |
| Updater `pubkey` | `tauri.conf.json` | Your signing public key |
| Updater `endpoints` | `tauri.conf.json` | Your update manifest URL |

## What to delete

The template ships with demo content that exercises every built-in feature.
Delete it when you start your own app:

- `src/lib/components/demo/` — the `WelcomePane` and its tiles
- `src/lib/commands/notification-commands.ts` — notification demo
- `src/lib/commands/clipboard-commands.ts` — clipboard demo
- `src/lib/commands/dialog-commands.ts` — file dialog demo
- `src/lib/commands/shell-commands.ts` — shell command demo
- `src/lib/commands/process-commands.ts` — relaunch demo (`demoRelaunchApp`)
- `src-tauri/src/commands/demo.rs` — `greet` command
- Remove their registrations from `src/lib/commands/index.ts`
- Remove demo locale keys (prefixed `demo.` and `welcome.`) from
  `locales/en.json`

## What to customise

| What | Where |
| --- | --- |
| **Window title** | `locales/en.json` → `titlebar.default` |
| **Main content** | Replace `<WelcomePane />` in `App.svelte` |
| **Left sidebar** | Replace the `left` snippet in `App.svelte` |
| **Right sidebar** | Replace the `right` snippet in `App.svelte` |
| **Preferences panes** | Edit `PreferencesDialog.svelte` — add panes alongside General/Appearance/Advanced |
| **App menu** | Edit `src/lib/menu.ts` — add items via `commandItem()` |

## Where to put your code

| Kind | Location |
| --- | --- |
| Svelte components | `src/lib/components/` |
| Stores (reactive state) | `src/lib/stores/` |
| Commands (user actions) | `src/lib/commands/` |
| Rust commands | `src-tauri/src/commands/` |
| Utilities | `src/lib/utils/` |
| Locale strings | `locales/en.json` |

## Common tasks

### Add a command

Create a module in `src/lib/commands/`, define `AppCommand` objects with a
unique `id` and an i18n `labelKey`, register them in `initCommands()`. See
[Commands & Shortcuts](docs/developer/commands-and-shortcuts.md).

### Add a keyboard shortcut

Set the `shortcut` field on an `AppCommand` (e.g. `'mod+shift+n'`). `mod`
maps to Cmd on macOS, Ctrl elsewhere. See
[Commands & Shortcuts](docs/developer/commands-and-shortcuts.md).

### Add a global shortcut

Add a `ShortcutPurpose` variant in Rust, an entry in the `PURPOSES` table in
`commit-shortcut.ts`, and a `ShortcutPicker` in Preferences. See
[Commands & Shortcuts](docs/developer/commands-and-shortcuts.md#adding-a-third-global-shortcut).

### Add a persisted preference

Add the field to `AppPreferences` in `src-tauri/src/types.rs` (with
`#[serde(default)]`), regenerate bindings (`pnpm run rust:bindings`), add it
to the TS schema defaults and sanitiser in `preferences-schema.ts`. See
[State Management](docs/developer/state-management.md#adding-a-new-persisted-field).

### Add a language

Import the JSON in `src/lib/i18n/config.ts`, add to `resources` and
`languageLabels`. See [Internationalisation](docs/developer/i18n.md#adding-a-locale).

### Add a Rust HTTP command

Add `reqwest` to `Cargo.toml`, create a `#[tauri::command] #[specta::specta]`
function, register in `bindings.rs`, regenerate bindings. See
[External APIs](docs/developer/external-apis.md).

## Quick Pane

The Quick Pane is a multi-window floating panel triggered by a global shortcut.
Keep it if your app needs a quick-capture surface; remove it if not.

**To remove:** delete `src-tauri/src/commands/quick_pane.rs` and its
`collect_commands!` entries, the `QuickPane` variant from `ShortcutPurpose`,
the Vite input in `vite.config.ts`, the three `quick-pane*` frontend files
(`quick-pane.html`, `src/quick-pane-main.ts`, `src/quick-pane.css`),
`src/lib/quick-pane/`, `src/lib/components/quick-pane/`, and
`capabilities/quick-pane.json`.

See [Quick Panes](docs/developer/quick-panes.md) for the full architecture.

## Development workflow

```bash
pnpm tauri dev          # Start the app in dev mode
pnpm check:all          # Run every lint, test, and analysis tool
pnpm test               # Vitest in watch mode
pnpm rust:test          # Rust tests only
pnpm rust:bindings      # Regenerate TypeScript bindings after changing Rust commands
```

## Releasing

```bash
node scripts/prepare-release.js v1.0.0   # Bumps versions, runs check:all, commits, tags
git push origin main --tags               # Triggers the release workflow
```

The release workflow builds for macOS (aarch64 + x86_64), Linux, and Windows,
then uploads signed artifacts to a draft GitHub release. See
[Releases](docs/developer/releases.md).

## Theme engine

The template ships with static light/dark tokens via shadcn CSS variables. An
OKLCH runtime theme engine — generating a full palette from a single base
hue — can be layered on later without restructuring, because the tokens are
standard CSS variables. See [Theme System](docs/developer/theme-system.md).

## Developer docs

The `docs/developer/` directory contains reference documentation for every
subsystem. See the [index](docs/developer/README.md) for the full list.
