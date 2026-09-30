# Releases

## Release preparation

`scripts/prepare-release.js` orchestrates a release from a clean working tree:

```
node scripts/prepare-release.js v1.0.0
```

Steps:

1. **Validates** the version argument (semver, `vX.Y.Z`)
2. **Clean-tree gate** — aborts if `git status --porcelain` is non-empty
3. **Quality gate** — runs `pnpm check:all` (every lint, test, and analysis
   tool)
4. **Bumps** the version in three files synchronously:
   - `package.json` → `"version": "1.0.0"`
   - `src-tauri/tauri.conf.json` → `"version": "1.0.0"`
   - `src-tauri/Cargo.toml` → `version = "1.0.0"`
5. **Prompts** for confirmation, then commits and tags

## CI workflow (`.github/workflows/ci.yml`)

Runs on every push to `main` and on every pull request.

**Frontend job** (ubuntu-latest):
`format:check` → `lint` → `svelte-check` → `ast-grep` → `knip` → `jscpd` → `vitest`

**Rust job** (ubuntu-latest + windows-latest + macos-latest matrix):
`cargo fmt --check` → `cargo clippy` → `cargo test`

The Windows matrix is deliberate — the `comctl32.dll` delay-load in `build.rs`
only surfaces on Windows, and missing it crashes every test binary with
`STATUS_ENTRYPOINT_NOT_FOUND`. macOS is in the matrix because Ostralith is
macOS-first: without it, code behind `cfg(target_os = "macos")` would never be
compiled in CI.

## Release workflow (`.github/workflows/release.yml`)

Triggered by pushing a `v*` tag (e.g. `git push origin v1.0.0`).

1. **Creates a draft GitHub release** with auto-generated release notes
2. **Builds on 4 targets** in parallel:
   - macOS aarch64 (Apple Silicon)
   - macOS x86_64 (Intel)
   - Ubuntu 22.04 (Linux)
   - Windows latest
3. **Uploads signed artifacts** via `tauri-apps/tauri-action@v1`

Required secrets:

| Secret | Purpose |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | Signs update artifacts |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Unlocks the signing key |

The release is created as a draft — review and publish manually.

## Auto-updater

`tauri-plugin-updater` is pre-wired in the plugin chain (`lib.rs`) and
configured in `tauri.conf.json`:

```json
"plugins": {
  "updater": {
    "pubkey": "...",
    "endpoints": ["https://YOUR_GITHUB_USER.github.io/YOUR_REPO/latest.json"]
  }
}
```

Both the public key and the endpoint are placeholders: the endpoint points at
`https://updates.ostralith.invalid/…`, which never resolves. Generate a signing
key with `pnpm tauri signer generate` and set a real endpoint before shipping.

The frontend never calls the updater plugin directly. Preferences → About
calls the app's `check_for_update` / `install_update` commands
(`src-tauri/src/commands/updater.rs`), which run every endpoint and the
download URL through `NetClient::authorize_external` first. Checks therefore
respect offline mode and appear in the network activity log, only happen when
the user clicks **Check for updates**, and return `FeatureDisabled` when no
endpoint is configured. See [Privacy & Network](privacy.md).

`createUpdaterArtifacts: true` in the bundle config tells the build to produce
the `.sig` signature files and `latest.json` manifest that the updater client
expects.

## Release profile

`src-tauri/Cargo.toml` configures the release build for minimal binary size:

```toml
[profile.release]
codegen-units = 1    # Better optimisation (single codegen unit)
lto = true           # Link-time optimisation across crates
opt-level = "s"      # Optimise for size over speed
panic = "abort"      # No unwinding machinery
strip = true         # Strip debug symbols from the binary
```

This typically reduces the binary by 20-30% compared to the default release
profile.

## Unused command stripping

`tauri.conf.json` sets `"removeUnusedCommands": true` in the build config.
Tauri's build step analyses which IPC commands the frontend actually imports
and strips the rest from the binary. Plugins that are registered in Rust but
never called from the frontend (like `tauri-plugin-fs` in this app)
have their IPC commands removed automatically.
