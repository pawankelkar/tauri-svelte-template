# Theme System

A port of sarde-studio's theme system. Any VS Code theme JSON can become a
full app theme: a 38-token OKLCH derivation engine expands four anchors —
accent, background, foreground, contrast — into the complete `--sd-*` token
set, applies WCAG contrast floors, and paints the tokens as inline custom
properties on `<html>`. Tailwind's semantic colours resolve through those
tokens, so components need zero edits to follow a theme.

## Layers

| Layer | File(s) | Role |
| --- | --- | --- |
| Engine | `src/lib/theme/engine.ts` | `deriveThemeTokens(anchors, mode)` → 38 tokens, pure and deterministic |
| Colour math | `src/lib/utils/color.ts` | OKLCH ↔ sRGB, contrast ratios, alpha handling |
| Presets | `src/lib/theme/presets.ts` | Default Light/Dark built-ins + profile → tokens path |
| Catalog | `src/lib/theme/vscode-catalog{,-index}.ts`, `vscode-themes/` | 65 vendored VS Code/Shiki themes, lazy-loaded on install |
| Import | `src/lib/theme/vscode-import.ts`, `jsonc.ts`, `anchor-validation.ts` | Theme JSON → validated preset, contrast-gated |
| Apply | `src/lib/theme/apply.ts`, `dom-state.ts` | Inline `--sd-*` props + `.dark` class + `data-*` attributes |
| Pre-mount paint | `src/lib/theme/paint-hint.ts` | Cached token payload painted before mount |
| Store | `src/lib/stores/theme.svelte.ts` | Mode + per-slot profiles, user presets, repaint, cross-window broadcast |
| UI | `src/lib/components/preferences/` | Mode cards, preset gallery, anchor editing, browse dialog |
| Bridge | `src/app.css` | `--background: var(--sd-bg-base, <fallback>)` etc. |

## Data model (sarde-studio's)

- **Preset** (`ThemePreset`): a named, single-mode anchor set plus verbatim
  `overrides` pinning the source theme's workbench colours. Built-ins are
  just Default Light and Default Dark (they reproduce the stock shadcn
  palette; their neutral accent is why they pin a red `danger`). Everything
  else lives in the persisted user registry (`importedThemes`).
- **Profile** (`ThemeProfile`): what `preferences.json` stores per mode slot
  — `{ presetId, customized, accent, background, foreground, contrast }`.
  `lightProfile` and `darkProfile` are independent: the mode toggle switches
  slots, and each slot can point at a different preset.
- **Customized**: manual anchor edits (or the contrast slider) set
  `customized: true`; from then on `deriveTokensForProfile` derives from the
  profile's anchors alone and the preset's override map no longer applies.
  "Reset to preset" reverts. Deleting a preset in use keeps the profile's
  colours (the anchors live in the profile) but drops the overrides.

## Tokens and the Tailwind bridge

The engine emits `--sd-bg-base`, `--sd-text`, `--sd-accent`, borders,
semantic colours, washes, scrollbar and shadow tokens (see `TOKEN_NAMES` in
`engine.ts`). `app.css` points every shadcn variable at one:

```css
--background: var(--sd-bg-base, oklch(1 0 0));
--foreground: var(--sd-text, oklch(0.145 0 0));
```

The oklch fallbacks reproduce the stock palette for the instant before the
first paint. `--destructive-foreground` and the chart colours stay static on
purpose. Derived `text` / `text-muted` are floor-pushed to 4.5:1 and
`border-focus` to 3:1; explicit overrides are never "corrected".

## Appearance pane (Preferences → Appearance)

- **Mode cards** — System / Light / Dark, each previewing the corresponding
  profile's real derived tokens on a mini window mock (the System card is a
  diagonal split of both).
- **Customize profile** — a Light/Dark segmented toggle picks which slot is
  being edited (independent of the live mode), a swatch-card gallery of that
  mode's presets (user presets get a hover delete), anchor fields with
  colour pickers and live contrast readouts (AAA/AA/OK/Low badges), and the
  0–100 contrast slider. Invalid anchor sets are rejected with the exact
  floor that failed — never silently corrected.
- **Browse themes…** — search + light/dark filter over the 65-theme catalog;
  Install converts the JSON (lazy-loaded chunk) and registers it as a user
  preset. Content-identical re-installs dedupe; colliding ids get suffixed
  (`dracula-theme-2`, "Dracula Theme (2)").
- **Import theme…** — native file picker → `read_theme_file` Rust command
  (extension-pinned, 2 MB cap) → JSONC parse → conversion → registered *and*
  activated in the slot matching the theme's own mode.

## Persistence

`preferences.json` carries `theme` (mode), `lightProfile`, `darkProfile`,
and `importedThemes` (converted presets — never raw VS Code JSON). Rust
validates on save (`validate_preferences` in `src-tauri/src/types.rs`); the
frontend re-validates on load (`sanitizePreferences`), falling broken
profiles back to the defaults and dropping broken imports.

## Flash-free boot

The window starts hidden (`visible: false`). Before Svelte mounts, `main.ts`
calls `paintFromHint()`, which reads a cached payload from
`localStorage['theme-paint-hint']` — resolved token maps for *both* slots,
so a `system` boot picks the right one synchronously via `matchMedia` — and
paints tokens + `.dark` + `data-*` in one go. With no payload (first run),
the legacy `ui-theme` mode hint plus the app.css fallbacks produce the stock
palette. After `initPreferences()` loads from disk, `reconcileTheme()`
repaints from the authoritative store and rewrites both hints.

## Cross-window sync

The Quick Pane shares `localStorage` but not stores. On any theme change the
main window rewrites the paint hint, then emits `theme-changed`; the Quick
Pane's listener (and its focus handler) just calls `paintFromHint()` again —
full token payload included, so it follows preset switches and anchor edits,
not only mode.

## Store API (`src/lib/stores/theme.svelte.ts`)

| Function | Purpose |
| --- | --- |
| `getThemeMode()` / `setThemeMode(mode)` | Mode preference (`light`/`dark`/`system`) |
| `getResolvedMode()` | Mode with `system` resolved against `matchMedia` |
| `getProfile(slot)` | The stored profile for a mode slot |
| `setPreset(slot, id)` | Point a slot at a preset (discards customization) |
| `setAnchors(slot, patch)` | Anchor/contrast edit; marks the profile customized |
| `canResetProfile(slot)` / `resetProfileToPreset(slot)` | Undo customization |
| `getUserPresets()` | The persisted user registry |
| `registerUserPreset(preset)` | Install (dedupes content, suffixes ids); does not activate |
| `deleteUserPreset(id)` | Remove from the registry |
| `initTheme()` / `reconcileTheme()` | matchMedia listener / authoritative repaint |

## Extending

- **Refresh or extend the catalog**: replace `vscode-themes/*.json` with a
  newer [tm-themes](https://github.com/shikijs/textmate-grammars-themes)
  snapshot and regenerate `vscode-catalog-index.ts` (sarde-studio's
  `scripts/generate-vscode-catalog.mjs` produces the entries). Confirm
  attributions are covered by the vendored `NOTICE`.
- **Live preview / palette switcher**: `deriveTokensForProfile` +
  `applyTokens` without touching preferences is a complete preview path —
  the mode cards already use it.
- **Syntax highlighting tokens**: sarde-studio's `syntax.js` (12
  `--sd-syntax-*` tokens) was deliberately not ported; add it if an app
  grows a code editor.
