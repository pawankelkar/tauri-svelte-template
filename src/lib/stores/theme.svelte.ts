import { emit } from '@tauri-apps/api/event'
import { getPreferences, setPreference } from './preferences.svelte'
import {
  THEME_STORAGE_KEY,
  PAINT_HINT_VERSION,
  writePaintHint,
  type PaintHintPayload,
} from '$lib/theme/paint-hint'
import type { ThemeVariantMode } from '$lib/theme/engine'
import { applyTokens } from '$lib/theme/apply'
import { applyDomState } from '$lib/theme/dom-state'
import {
  getPresetById,
  profileFromPreset,
  deriveTokensForProfile,
  mergeImportedPreset,
  presetContentEquals,
} from '$lib/theme/presets'
import type { ThemePreset, ThemeProfile } from '$lib/theme/schema'
import type { ThemeMode } from './preferences-schema'
import type { ImportedTheme } from '$lib/tauri-bindings'

// The generated ImportedTheme mirrors ThemePreset but is looser (string
// mode, required nullable overrides) — sanitizePreferences has already run
// every stored entry through validateThemePreset, so these casts only bridge
// the nominal gap at the store boundary.
const asPresets = (themes: ImportedTheme[]): ThemePreset[] =>
  themes as unknown as ThemePreset[]
const asStored = (themes: ThemePreset[]): ImportedTheme[] =>
  themes.map((t) => ({
    ...t,
    overrides: t.overrides ?? null,
  })) as unknown as ImportedTheme[]

const slotKey = (slot: ThemeVariantMode): 'lightProfile' | 'darkProfile' =>
  slot === 'light' ? 'lightProfile' : 'darkProfile'

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v))

let _systemDark = $state(
  typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches,
)

export function getThemeMode(): ThemeMode {
  return getPreferences().theme as ThemeMode
}

export function getResolvedMode(): ThemeVariantMode {
  const mode = getThemeMode()
  return mode === 'system' ? (_systemDark ? 'dark' : 'light') : mode
}

/** The stored profile for a mode slot. */
export function getProfile(slot: ThemeVariantMode): ThemeProfile {
  return getPreferences()[slotKey(slot)]
}

/** Installed/imported presets (the user's registry, persisted). */
export function getUserPresets(): ThemePreset[] {
  return asPresets(getPreferences().importedThemes)
}

function paint(target: HTMLElement = document.documentElement): void {
  const mode = getResolvedMode()
  const profile = getProfile(mode)
  applyTokens(deriveTokensForProfile(profile, mode, getUserPresets()), target)
  applyDomState(profile.presetId, mode, target)
}

function buildHintPayload(): PaintHintPayload {
  const tokens = (slot: ThemeVariantMode) =>
    deriveTokensForProfile(getProfile(slot), slot, getUserPresets())
  return {
    v: PAINT_HINT_VERSION,
    mode: getThemeMode(),
    presetId: {
      light: getProfile('light').presetId,
      dark: getProfile('dark').presetId,
    },
    slots: { light: tokens('light'), dark: tokens('dark') },
  }
}

function syncHint(): void {
  localStorage.setItem(THEME_STORAGE_KEY, getThemeMode())
  writePaintHint(buildHintPayload())
}

function repaint(): void {
  paint()
  syncHint()
}

/**
 * Tells the other windows to repaint.
 *
 * They have their own JS contexts and cannot see this store, but they can read
 * the `localStorage` hint — which `syncHint()` has already written by the time
 * this fires — so the payload is informational and the event is the trigger.
 */
function broadcast(): void {
  void emit('theme-changed', {
    mode: getThemeMode(),
    resolved: getResolvedMode(),
  })
}

export function initTheme(): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  _systemDark = mq.matches
  const onChange = (e: MediaQueryListEvent) => {
    _systemDark = e.matches
    if (getThemeMode() === 'system') {
      repaint()
      // A system-level flip changes the resolved theme without anyone touching
      // a preference, so the other windows need telling here too.
      broadcast()
    }
  }
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

export function reconcileTheme(): void {
  repaint()
}

export function setThemeMode(mode: ThemeMode): void {
  setPreference('theme', mode)
  repaint()
  broadcast()
}

/** Points a mode slot at a preset, discarding any customization. */
export function setPreset(slot: ThemeVariantMode, presetId: string): void {
  const preset = getPresetById(presetId, getUserPresets())
  if (!preset) return
  setPreference(slotKey(slot), profileFromPreset(preset))
  repaint()
  broadcast()
}

/**
 * Manual anchor edits mark the profile customized; the preset's override map
 * no longer applies (deriveTokensForProfile derives from anchors alone).
 * Callers gate hex anchors through validateAnchorEdit first — the store only
 * clamps contrast.
 */
export function setAnchors(
  slot: ThemeVariantMode,
  patch: Partial<
    Pick<ThemeProfile, 'accent' | 'background' | 'foreground' | 'contrast'>
  >,
): void {
  const next: ThemeProfile = {
    ...getProfile(slot),
    ...patch,
    customized: true,
  }
  next.contrast = clamp(next.contrast, 0, 100)
  setPreference(slotKey(slot), next)
  repaint()
  broadcast()
}

export function canResetProfile(slot: ThemeVariantMode): boolean {
  const profile = getProfile(slot)
  return (
    profile.customized && !!getPresetById(profile.presetId, getUserPresets())
  )
}

export function resetProfileToPreset(slot: ThemeVariantMode): void {
  const preset = getPresetById(getProfile(slot).presetId, getUserPresets())
  if (!preset) return
  setPreference(slotKey(slot), profileFromPreset(preset))
  repaint()
  broadcast()
}

/**
 * Registers a converted preset in the user registry without activating it
 * (the browse dialog's Install semantics). A content-identical preset is not
 * duplicated; a colliding id is suffixed.
 */
export function registerUserPreset(preset: ThemePreset): {
  preset: ThemePreset
  already: boolean
} {
  const existing = getUserPresets().find((p) => presetContentEquals(p, preset))
  if (existing) return { preset: existing, already: true }
  const merged = mergeImportedPreset(preset, getUserPresets())
  setPreference('importedThemes', asStored([...getUserPresets(), merged]))
  repaint()
  broadcast()
  return { preset: merged, already: false }
}

/**
 * Deletes a user preset. Profiles pointing at it keep their colors — the
 * anchors live in the profile — but lose the preset's fine-tuned overrides
 * on the next derivation.
 */
export function deleteUserPreset(id: string): void {
  setPreference(
    'importedThemes',
    asStored(getUserPresets().filter((p) => p.id !== id)),
  )
  repaint()
  broadcast()
}
