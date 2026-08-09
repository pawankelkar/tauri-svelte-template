# Theme System

## Modes

Three options: `light`, `dark`, `system`. The active mode is stored in
`preferences.json` as the `theme` field.

## Flash-free boot

The window starts hidden (`visible: false` in `tauri.conf.json`). Before
Svelte mounts, `main.ts` calls `paintFromHint()`:

```ts
// src/lib/theme/paint-hint.ts
export function paintFromHint(target = document.documentElement): void {
  const stored = localStorage.getItem('ui-theme')
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const isDark = stored === 'dark' || (stored !== 'light' && prefersDark)
  target.classList.toggle('dark', isDark)
}
```

This applies `.dark` synchronously from `localStorage`, so the first paint
already has the correct colours. The window is only shown after mount.

## Authoritative reconciliation

`localStorage` is a hint — the preferences file is the source of truth. After
`initPreferences()` loads from disk, `App.svelte` calls `reconcileTheme()`,
which reapplies the class from the authoritative preference and updates the
hint to match.

## Theme store (`src/lib/stores/theme.svelte.ts`)

| Function | Purpose |
| --- | --- |
| `getThemeMode()` | Current mode from preferences |
| `getResolvedMode()` | `'light'` or `'dark'` (resolves `system` against `matchMedia`) |
| `initTheme()` | Starts the `matchMedia` listener for system scheme changes; returns cleanup |
| `reconcileTheme()` | Reapplies class + hint from the authoritative preference |
| `setThemeMode(mode)` | Updates preference, repaints, broadcasts to other windows |

The `.dark` class on `<html>` drives all theming — Tailwind's `dark:` variants
and shadcn's CSS variables both key off it.

## Design tokens (`src/styles/theme-variables.css`)

OKLCH-valued CSS variables under `:root` and `.dark`, registered into
Tailwind v4 via `@theme inline` in `app.css`. These are the shadcn-svelte
colour tokens — components use them as `bg-background`, `text-foreground`, etc.

## Cross-window sync

The Quick Pane runs in a separate webview with its own JS context. It cannot
see the main window's stores, but both windows share an origin and therefore a
common `localStorage`.

When the theme changes, the main window:

1. Writes the mode to `localStorage['ui-theme']` (via `syncHint()`)
2. Emits a Tauri event: `emit('theme-changed', { mode, resolved })`

The Quick Pane listens for `theme-changed` and reapplies. On focus gain, it
also re-reads the hint — catching changes that happened while the pane was
hidden.

System-level scheme flips (e.g. the OS switching to dark mode) also trigger a
broadcast, because the Quick Pane has no live `matchMedia` reaction while
hidden.

## Future: OKLCH runtime engine

The shadcn tokens are plain CSS variables. A runtime theme engine that
generates OKLCH values from a base hue can be layered on later without
restructuring — just overwrite the variables. This is documented as a future
opt-in; v1 ships with the static token set.
