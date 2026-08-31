# Developer Docs

## Architecture

| Doc | Description |
| --- | --- |
| [Architecture Guide](architecture-guide.md) | Project layout, boot sequence, dispatch model, Svelte 5 patterns |
| [State Management](state-management.md) | Stores, schemas, debounced persistence, flush-on-close |
| [Persistence & Recovery](persistence-and-recovery.md) | JSON store, atomic writes, corrupt-file recovery, crash data |

## Features

| Doc | Description |
| --- | --- |
| [Commands & Shortcuts](commands-and-shortcuts.md) | Command registry, palette, keyboard shortcuts, global shortcuts, menus |
| [Theme System](theme-system.md) | Light/dark/system modes, flash-free boot, cross-window sync |
| [Internationalisation](i18n.md) | i18next setup, locale management, RTL support, adding languages |
| [Cross-Platform](cross-platform.md) | Platform detection, titlebar variants, context menus, capabilities |
| [Quick Panes](quick-panes.md) | Multi-window architecture, Vite dual-entry, cross-window events |
| [Error Handling](error-handling.md) | Error boundary, logging, crash reporting, diagnostics, quit confirmation, two-phase close |

## Tooling

| Doc | Description |
| --- | --- |
| [Quality](quality.md) | Vitest, cargo test, ast-grep, knip, jscpd, check:all pipeline |
| [Releases](releases.md) | prepare-release, CI/CD workflows, auto-updater, release profile |
| [External APIs](external-apis.md) | Rust reqwest vs frontend fetch, auth token storage, offline caching |
| [Bundle Optimisation](bundle-optimization.md) | Release profile, unused command stripping, tree-shaking, plugin removal |
