# Developer Docs

## Architecture

| Doc | Description |
| --- | --- |
| [Architecture Guide](architecture-guide.md) | Rust/Svelte boundary, project layout, Cargo workspace, sidecars, boot sequence, Svelte 5 patterns |
| [Privacy & Network](privacy.md) | Offline-by-default policy, `NetClient`, activity log, updater gating, local Pro flags |
| [State Management](state-management.md) | Stores, schemas, debounced persistence, flush-on-close |
| [Persistence & Recovery](persistence-and-recovery.md) | JSON store, atomic writes, corrupt-file recovery, crash data |

## Features

| Doc | Description |
| --- | --- |
| [Workspace](workspace.md) | Tabs, editor groups, `ostralith://` URIs, view registry, deep-link routing |
| [Commands & Shortcuts](commands-and-shortcuts.md) | Command registry, context keys and `when`, palette, keymap, conflicts, global shortcuts, menus |
| [Theme System](theme-system.md) | Light/dark/system modes, flash-free boot, cross-window sync |
| [Internationalisation](i18n.md) | i18next setup, locale management, RTL support, adding languages |
| [Cross-Platform](cross-platform.md) | Platform detection, titlebar variants, context menus, capabilities, deep links |
| [Quick Panes](quick-panes.md) | Multi-window architecture, Vite dual-entry, cross-window events |
| [Error Handling](error-handling.md) | Error boundary, logging, crash reporting, diagnostics, quit confirmation, two-phase close |

## Tooling

| Doc | Description |
| --- | --- |
| [Quality](quality.md) | Vitest, cargo test, ast-grep (incl. `no-fetch`), clippy, knip, jscpd, check:all pipeline |
| [Releases](releases.md) | prepare-release, CI/CD workflows, auto-updater, release profile |
| [External APIs](external-apis.md) | HTTP through `NetClient`, auth token storage, offline caching |
| [Bundle Optimisation](bundle-optimization.md) | Release profile, unused command stripping, tree-shaking, plugin removal |
