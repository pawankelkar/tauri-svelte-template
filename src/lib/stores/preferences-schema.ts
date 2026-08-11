import type {
  AppPreferences,
  ImportedTheme,
  ThemeProfile,
} from '$lib/tauri-bindings'
import { validateThemePreset, validateThemeProfile } from '$lib/theme/schema'
import { normalizeShortcut, parseShortcut } from '$lib/shortcuts'
import {
  BUILTIN_PRESETS,
  DEFAULT_LIGHT,
  DEFAULT_DARK,
  profileFromPreset,
} from '$lib/theme/presets'

export type ThemeMode = 'light' | 'dark' | 'system'

const THEME_MODES: readonly ThemeMode[] = ['light', 'dark', 'system']

export function isThemeMode(value: unknown): value is ThemeMode {
  return (
    typeof value === 'string' &&
    (THEME_MODES as readonly string[]).includes(value)
  )
}

export type ReducedMotion = 'system' | 'on' | 'off'

const REDUCED_MOTION_MODES: readonly ReducedMotion[] = ['system', 'on', 'off']

export function isReducedMotion(value: unknown): value is ReducedMotion {
  return (
    typeof value === 'string' &&
    (REDUCED_MOTION_MODES as readonly string[]).includes(value)
  )
}

/** Mirrors `validate_font_size` in `src-tauri/src/types.rs`. */
export const FONT_SIZE_MIN = 12
export const FONT_SIZE_MAX = 20

/**
 * Mirrors `DEFAULT_QUICK_PANE_SHORTCUT` in `src-tauri/src/types.rs`.
 *
 * Rust owns the authoritative default — it registers the accelerator during
 * `setup()`, before the frontend exists — but the value is repeated here so a
 * failed load still shows the user what is actually bound.
 */
export const DEFAULT_QUICK_PANE_SHORTCUT = 'CmdOrCtrl+Shift+.'

export function defaultPreferences(): AppPreferences {
  return {
    theme: 'system',
    lightProfile: profileFromPreset(DEFAULT_LIGHT),
    darkProfile: profileFromPreset(DEFAULT_DARK),
    importedThemes: [],
    fontFamily: null,
    fontSize: 16,
    reducedMotion: 'system',
    pointerCursors: false,
    windowEffects: false,
    language: null,
    globalShortcut: null,
    quickPaneShortcut: DEFAULT_QUICK_PANE_SHORTCUT,
    commandShortcuts: {},
  }
}

/**
 * Keeps only well-formed override entries: `null` (explicitly unbound) or a
 * combo that normalises to a key plus at least one modifier — the same rule
 * the keydown dispatcher enforces, so a hand-edited entry that could never
 * fire is dropped rather than shown as bound.
 */
function sanitizeCommandShortcuts(raw: unknown): Record<string, string | null> {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string | null> = {}
  for (const [id, value] of Object.entries(raw)) {
    if (!id) continue
    if (value === null) {
      out[id] = null
    } else if (typeof value === 'string') {
      const normalized = normalizeShortcut(value)
      const { key, modifiers } = parseShortcut(normalized)
      if (key && modifiers.length > 0) out[id] = normalized
    }
  }
  return out
}

function sanitizeProfile(raw: unknown, fallback: ThemeProfile): ThemeProfile {
  return validateThemeProfile(raw).length === 0
    ? (raw as ThemeProfile)
    : fallback
}

/**
 * Keeps only structurally valid imported themes. A hand-edited entry that
 * fails the preset schema is dropped rather than repaired — the theme system
 * falls back to Default if the active preset disappears with it.
 *
 * An entry whose id collides with a built-in preset is dropped too: the
 * built-in fully replaces a copy installed before that theme was promoted
 * to built-in, and getPresetById's built-in-first precedence keeps profiles
 * pointing at that presetId resolving without a duplicate grid tile.
 */
function sanitizeImportedThemes(raw: unknown): ImportedTheme[] {
  if (!Array.isArray(raw)) return []
  const builtinIds = new Set(BUILTIN_PRESETS.map((p) => p.id))
  return raw.filter(
    (entry): entry is ImportedTheme =>
      validateThemePreset(entry).length === 0 &&
      !builtinIds.has((entry as ImportedTheme).id),
  )
}

export function sanitizePreferences(raw: unknown): AppPreferences {
  const defaults = defaultPreferences()
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw))
    return defaults

  const r = raw as Partial<AppPreferences>
  return {
    theme: isThemeMode(r.theme) ? r.theme : defaults.theme,
    lightProfile: sanitizeProfile(r.lightProfile, defaults.lightProfile),
    darkProfile: sanitizeProfile(r.darkProfile, defaults.darkProfile),
    importedThemes: sanitizeImportedThemes(r.importedThemes),
    fontFamily: typeof r.fontFamily === 'string' ? r.fontFamily : null,
    fontSize:
      typeof r.fontSize === 'number' &&
      r.fontSize >= FONT_SIZE_MIN &&
      r.fontSize <= FONT_SIZE_MAX
        ? r.fontSize
        : defaults.fontSize,
    reducedMotion: isReducedMotion(r.reducedMotion)
      ? r.reducedMotion
      : defaults.reducedMotion,
    pointerCursors:
      typeof r.pointerCursors === 'boolean'
        ? r.pointerCursors
        : defaults.pointerCursors,
    windowEffects:
      typeof r.windowEffects === 'boolean'
        ? r.windowEffects
        : defaults.windowEffects,
    language: typeof r.language === 'string' ? r.language : null,
    globalShortcut:
      typeof r.globalShortcut === 'string' ? r.globalShortcut : null,
    quickPaneShortcut:
      typeof r.quickPaneShortcut === 'string' ? r.quickPaneShortcut : null,
    commandShortcuts: sanitizeCommandShortcuts(r.commandShortcuts),
  }
}
