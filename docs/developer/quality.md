# Quality

## Testing

### Frontend: Vitest

Tests run with `pnpm test` (watch) or `pnpm test:run` (single run), using
jsdom as the DOM environment.

**Naming convention:** test files are co-located with their source:

- `*.test.ts` — plain TypeScript modules
- `*.svelte.test.ts` — modules that use Svelte 5 runes (the `.svelte.ts`
  extension enables rune syntax)

**Store reset pattern:** each persisted store exports a
`__reset*ForTests()` function. Call it in `beforeEach` to isolate tests:

```ts
import { __resetCommandsForTests } from '$lib/commands/registry.svelte'

beforeEach(() => {
  __resetCommandsForTests()
})
```

**Existing test coverage:**

| Area | File |
| --- | --- |
| Command registry | `commands/registry.svelte.test.ts` |
| Preferences schema | `stores/preferences-schema.test.ts` |
| App-state schema | `stores/app-state-schema.test.ts` |
| Debounce-persist | `utils/debounce-persist.test.ts` |
| Context-menu types | `context-menu.test.ts` |
| Shortcuts | `shortcuts.test.ts` |
| Theme store | `stores/theme.svelte.test.ts` |
| Commit-shortcut | `components/preferences/commit-shortcut.test.ts` |
| Logger | `logger.test.ts` |
| Platform-strings | `platform-strings.test.ts` |
| UI store | `stores/ui.svelte.test.ts` |
| Confirm dialog | `stores/confirm.svelte.test.ts` |
| Toast store | `stores/toast.test.ts` |
| i18n config | `i18n/config.test.ts` |
| Quick-pane bridge | `quick-pane/bridge.test.ts` |
| Preferences dialog | `commands/preferences-dialog-state.svelte.test.ts` |

### Backend: cargo test

Rust tests live alongside the source in `#[cfg(test)] mod tests` blocks.
`src-tauri/src/commands/test_support.rs` provides `scratch_dir(module, test)`
for creating isolated temp directories.

Run with `pnpm rust:test` or `cd src-tauri && cargo test`.

CI runs `cargo test` on both Ubuntu and Windows — the Windows matrix catches
platform-specific issues like the `comctl32.dll` delay-load fix in `build.rs`.

### Manual UI verification

The frontend renders in a plain browser once the Tauri globals are stubbed.
The `run-app` skill (`.claude/skills/run-app/SKILL.md`) documents the working
recipe — dev server + Playwright with stubbed `__TAURI_INTERNALS__` /
`__TAURI_OS_PLUGIN_INTERNALS__` — including its two footguns (the synchronous
plugin-os global and the `/@fs/` import-URL rule). Anything crossing real IPC
still needs `pnpm tauri dev`.

---

## Static analysis

### `pnpm check:all`

Runs every gate in sequence, cheapest first:

```
format:check → lint → svelte-check + tsc → ast-grep → knip → jscpd → vitest → cargo fmt → cargo clippy → cargo test
```

A formatting slip fails in seconds rather than after the test suite.

### ast-grep rules

Two custom rules in `.ast-grep/rules/`:

**`snapshot-before-ipc.yml`** — enforces `$state.snapshot()` around any value
passed to a generated `commands.*` call in store files. A raw rune proxy does
not serialise over IPC — the Rust side receives garbage.

**`persisted-store-must-flush.yml`** — any module that calls
`createDebouncedPersist()` must also call `.flush()` somewhere. Without it, the
store loses pending writes when the app exits.

### knip

Unused file/export/dependency detection. Config in `knip.jsonc`:

- **Entry:** `src/quick-pane-main.ts` (the second Vite entry; `src/main.ts`
  is inferred from `index.html`)
- **Project:** `src/**/*.{ts,svelte}`
- **Ignore:** `src/lib/components/ui/**` (vendored shadcn output)
- **Ignore deps:** `tw-animate-css` (CSS-only import), `csstype` (bits-ui
  transitive type dep)
- **Tags:** `-@public` — exports tagged `@public` are intentional API surface
  for template consumers, not dead code
- **`ignoreExportsUsedInFile: true`** — an export consumed only within its own
  file is not flagged

Run: `pnpm knip`

### jscpd

Copy-paste / duplication detection. Config in `.jscpd.json`:

- **Pattern:** `src` and `src-tauri/src` directories
- **Ignores:** node_modules, target, `ui/`, bindings, test files
- **Thresholds:** `minLines: 10`, `minTokens: 50`, `threshold: 0.3`
- **Reporters:** console + JSON (output in `jscpd-report/`)
- **Respects `.gitignore`**

Run: `pnpm jscpd`

### ESLint + Prettier

ESLint with `eslint-plugin-svelte` and `eslint-config-prettier`. Prettier with
`prettier-plugin-svelte`. Run via `pnpm lint` / `pnpm format:check`.

### `.coderabbit.yaml`

AI PR review config for the CodeRabbit bot:

- **Profile:** chill (fewer nitpicks)
- **Collapse walkthroughs**, no sequence diagrams
- **Path filters:** excludes `.md`, lock files, generated bindings, shadcn
  `ui/`, locale JSON
- **Path instructions:** reviewers get context about `$state.snapshot()`,
  `$lib/tauri-bindings`, i18n keys, and specta conventions
