# Bundle Optimisation

## Release profile

`src-tauri/Cargo.toml` configures the Rust release build:

```toml
[profile.release]
codegen-units = 1
lto = true
opt-level = "s"
panic = "abort"
strip = true
```

| Setting | What it does | Trade-off |
| --- | --- | --- |
| `codegen-units = 1` | Compiles the entire crate as one unit, enabling better cross-module optimisation | Slower compilation |
| `lto = true` | Link-time optimisation across all crates | Slower linking |
| `opt-level = "s"` | Optimise for binary size over runtime speed | Marginally slower hot paths |
| `panic = "abort"` | Removes unwinding machinery | No panic backtraces in release |
| `strip = true` | Strips debug symbols from the binary | No symbol names in crash reports |

Combined impact: typically 20-30% smaller binary.

## Unused command stripping

`tauri.conf.json` sets:

```json
"build": {
  "removeUnusedCommands": true
}
```

Tauri's build step analyses the frontend bundle and removes IPC command
handlers that are never imported. For example, `tauri-plugin-fs` is registered
in Rust but nothing in the frontend imports `@tauri-apps/plugin-fs`, so its
commands are stripped from the binary.

## Tree-shaking

The frontend bundle is tree-shaken by Vite/Rollup. To maximise it:

**Use named imports:**

```ts
// Good — only the used function is bundled
import { getCurrentWindow } from '@tauri-apps/api/window'

// Bad — the entire module is included
import * as window from '@tauri-apps/api/window'
```

The `@tauri-apps/api/*` and `@tauri-apps/plugin-*` packages are designed for
named imports. The generated `$lib/bindings.ts` already uses this pattern.

## Removing unused plugins

If your app doesn't need a plugin, remove it from all four layers:

1. **Rust dependency** — remove from `Cargo.toml`
2. **Plugin init** — remove `.plugin(tauri_plugin_foo::init())` from `lib.rs`
3. **Capability grant** — remove the plugin's permissions from
   `capabilities/*.json`
4. **Frontend dependency** — remove `@tauri-apps/plugin-foo` from
   `package.json`

The template's demo-only plugins (notification, clipboard-manager, shell,
process) have already been removed this way. `dialog` stays for the theme
import picker, and `updater` stays behind the network policy (see
[Privacy & Network](privacy.md)).

## Code-splitting

Vite handles code-splitting for the two entry points (`index.html` and
`quick-pane.html`) automatically — shared dependencies are extracted into a
common chunk.

For heavy components that are rarely shown, use dynamic `import()`:

```ts
const HeavyEditor = (await import('./HeavyEditor.svelte')).default
```

Vite splits the import into a separate chunk loaded on demand.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Binary unexpectedly large | `lto` or `strip` not applied | Check `[profile.release]` in `Cargo.toml` |
| Plugin commands still in binary | Frontend imports the plugin | `removeUnusedCommands` only strips commands with no frontend import |
| Bundle includes unused JS | Wildcard import (`import *`) | Switch to named imports |
| Quick Pane chunk missing | `quick-pane.html` not in `rollupOptions.input` | Check `vite.config.ts` |
| Capability error at runtime | Permission removed but plugin still called | Audit both the Rust init and frontend imports |
