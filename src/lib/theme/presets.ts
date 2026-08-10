// Built-in theme presets and the stored-profile → tokens path, following
// the author's sarde-studio model (src/lib/theme/presets.js): presets are
// flat and single-mode, `preferences.json` carries one profile per mode
// slot, and everything beyond the two Defaults is installed from the
// vendored VS Code catalog or imported from a file into the user's presets.

import {
  deriveThemeTokens,
  type ThemeTokens,
  type ThemeVariantMode,
} from './engine'
import type { ThemePreset, ThemeProfile } from './schema'

// The stock template palette, expressed as anchors + pinned overrides so the
// engine reproduces it exactly. The accent is neutral (shadcn's near-black /
// near-white primary), which zeroes the chroma of the derived semantic
// colours — hence the pinned red danger, the one semantic token the
// template's Tailwind map actually uses (--destructive). Anchors are
// mirrored by `ThemeProfile::default_*` in `src-tauri/src/types.rs`.
export const DEFAULT_LIGHT: ThemePreset = {
  id: 'default-light',
  name: 'Default Light',
  mode: 'light',
  accent: '#171717',
  background: '#ffffff',
  foreground: '#0a0a0a',
  contrast: 50,
  overrides: {
    'bg-surface': '#fafafa',
    'bg-elevated': '#ffffff',
    border: '#e5e5e5',
    'text-muted': '#737373',
    'border-focus': '#a3a3a3',
    hover: '#f5f5f5',
    danger: '#e7000b',
  },
}

export const DEFAULT_DARK: ThemePreset = {
  id: 'default-dark',
  name: 'Default Dark',
  mode: 'dark',
  accent: '#fafafa',
  background: '#0a0a0a',
  foreground: '#fafafa',
  contrast: 50,
  overrides: {
    'bg-surface': '#171717',
    'bg-elevated': '#171717',
    border: '#262626',
    'text-muted': '#a3a3a3',
    'border-focus': '#525252',
    hover: '#262626',
    danger: '#e7000b',
  },
}

export const BUILTIN_PRESETS: ThemePreset[] = [DEFAULT_LIGHT, DEFAULT_DARK]

/** Built-ins first so a user preset can never shadow a built-in id. */
export function getPresetById(
  id: string,
  userPresets: ThemePreset[] = [],
): ThemePreset | null {
  return (
    BUILTIN_PRESETS.find((p) => p.id === id) ??
    userPresets.find((p) => p.id === id) ??
    null
  )
}

/**
 * A stored ThemeProfile pointing at this preset. Profiles carry anchors
 * only; the preset's override map is re-attached at derivation time by
 * deriveTokensForProfile while the profile is uncustomized.
 */
export function profileFromPreset(preset: ThemePreset): ThemeProfile {
  return {
    presetId: preset.id,
    customized: false,
    accent: preset.accent,
    background: preset.background,
    foreground: preset.foreground,
    contrast: preset.contrast,
  }
}

/**
 * Canonical stored-profile → tokens path. Once a profile is customized (or
 * its preset was deleted) its anchors alone define it.
 */
export function deriveTokensForProfile(
  profile: ThemeProfile,
  mode: ThemeVariantMode,
  userPresets: ThemePreset[] = [],
): ThemeTokens {
  const preset = getPresetById(profile.presetId, userPresets)
  const overrides = !profile.customized && preset ? preset.overrides : null
  return deriveThemeTokens({ ...profile, overrides }, mode)
}

/**
 * Re-ids an incoming preset so it can never collide with a built-in or an
 * already-installed one: `dracula-theme` becomes `dracula-theme-2`,
 * "Dracula Theme" becomes "Dracula Theme (2)".
 */
export function mergeImportedPreset(
  preset: ThemePreset,
  userPresets: ThemePreset[],
): ThemePreset {
  const reserved = new Set([
    ...BUILTIN_PRESETS.map((p) => p.id),
    ...userPresets.map((p) => p.id),
  ])
  if (!reserved.has(preset.id)) return preset
  let n = 2
  while (reserved.has(`${preset.id}-${n}`)) n += 1
  return { ...preset, id: `${preset.id}-${n}`, name: `${preset.name} (${n})` }
}

/**
 * Content identity for install dedupe: same source theme → same colours,
 * regardless of the id suffix a collision added.
 */
export function presetContentEquals(a: ThemePreset, b: ThemePreset): boolean {
  return (
    a.mode === b.mode &&
    a.accent === b.accent &&
    a.background === b.background &&
    a.foreground === b.foreground &&
    a.contrast === b.contrast &&
    JSON.stringify(a.overrides ?? null) === JSON.stringify(b.overrides ?? null)
  )
}
