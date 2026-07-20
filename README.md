# tauri-svelte-template

A production-ready template for building modern desktop applications with Tauri v2, Svelte 5, and TypeScript. This template provides a solid foundation with best practices, comprehensive documentation, and quality tooling built-in.

## Getting started

```bash
pnpm install
pnpm tauri dev
```

## Scripts

| Script               | What it does                                                   |
| -------------------- | -------------------------------------------------------------- |
| `pnpm tauri dev`     | Run the app with hot reload                                    |
| `pnpm test`          | Vitest in watch mode                                           |
| `pnpm check:all`     | Every gate below, cheapest first — this is what CI runs        |
| `pnpm format`        | Apply Prettier                                                 |
| `pnpm lint:fix`      | Apply ESLint autofixes                                         |
| `pnpm rust:bindings` | Regenerate `src/lib/bindings.ts` after changing a Rust command |

### The gates

`check:all` chains these in order, so the fastest failure surfaces first:

| Gate                | Tool                       | What it protects                                                 |
| ------------------- | -------------------------- | ---------------------------------------------------------------- |
| `pnpm format:check` | Prettier                   | One code style, no formatting diffs in review                    |
| `pnpm lint`         | ESLint                     | Import boundaries and logging discipline, in `.ts` and `.svelte` |
| `pnpm check`        | svelte-check + tsc         | Types, across the app and the Node-side build configs            |
| `pnpm ast-grep`     | ast-grep                   | Two syntax-shaped conventions (see below)                        |
| `pnpm knip`         | knip                       | Unused files, exports, and dependencies                          |
| `pnpm jscpd`        | jscpd                      | Copy-paste, across TypeScript, Svelte, and Rust                  |
| `pnpm test:run`     | Vitest                     | Frontend unit tests                                              |
| `pnpm rust:fmt`     | `cargo fmt --check`        | Rust formatting                                                  |
| `pnpm rust:clippy`  | `cargo clippy -D warnings` | Rust lints, warnings treated as errors                           |
| `pnpm rust:test`    | `cargo test`               | Rust unit tests                                                  |

**Division of labour between ESLint and ast-grep.** ast-grep has no Svelte
grammar, and the available workaround — parsing `.svelte` as HTML — matches
`<script>` bodies unreliably. So ESLint owns the rules that must hold inside
components (no raw `invoke()`, no `console`), and ast-grep owns the two rules
that are shaped like syntax rather than imports, in `.ts` and `.svelte.ts`:

- **`snapshot-before-ipc`** — a Svelte 5 `$state` proxy handed to a generated
  command serialises as a Proxy, so Rust deserialises garbage. Use
  `$state.snapshot()`.
- **`persisted-store-must-flush`** — a store that debounces writes but never
  exposes `.flush()` drops whatever was pending when the app exits.

Rules live in `.ast-grep/rules/`; add your own there and `ast-grep scan` picks
them up.

**A note on the jscpd threshold.** It is set to `0.3`, not `0`. One clone is
accepted: the two `round_trips_through_json_store` tests in
`src-tauri/src/commands/`, whose shared shape is the `mod tests` preamble.
Collapsing that needs a macro and costs more readability than it buys. The
threshold is low enough that any _new_ clone fails the gate.
