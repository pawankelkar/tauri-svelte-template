// Non-authoritative mirror of the last-applied theme, painted synchronously
// before the Svelte app mounts (top of main.ts / quick-pane-main.ts) so
// restarts never flash the stock palette. `preferences.json` remains the
// only authoritative store — once it loads, `reconcileTheme()` repaints
// unconditionally.
//
// The payload carries resolved token maps for BOTH mode slots: matchMedia is
// synchronous, so a System-mode boot resolves the current OS preference at
// paint time — correct even if the OS theme changed since the hint was
// written, with no engine work pre-mount. Pattern ported from the author's
// sarde-studio project (src/lib/theme/paint-hint.js).

import type { ReducedMotion } from '$lib/stores/preferences-schema'
import { isReducedMotion } from '$lib/stores/preferences-schema'
import type { ThemeTokens, ThemeVariantMode } from './engine'
import { applyAppearanceTokens, applyTokens } from './apply'
import { applyDomState } from './dom-state'
import { resolveReducedMotion } from './motion'

/**
 * Legacy mode hint ('light' | 'dark' | 'system'), still written on every
 * repaint: it is the fallback that keeps first-run and pre-token boots
 * painting the right stock palette when no full payload exists yet.
 */
export const THEME_STORAGE_KEY = 'ui-theme'

export const PAINT_HINT_KEY = 'theme-paint-hint'
export const PAINT_HINT_VERSION = 3

export interface PaintHintPayload {
  v: number
  mode: 'light' | 'dark' | 'system'
  presetId: Record<ThemeVariantMode, string>
  slots: Record<ThemeVariantMode, Partial<ThemeTokens>>
  fontFamily: string | null
  fontSize: number
  /** Raw preference — 'system' re-resolves via matchMedia at paint time. */
  reducedMotion: ReducedMotion
  pointerCursors: boolean
  windowEffects: boolean
}

export function writePaintHint(payload: PaintHintPayload): void {
  try {
    localStorage.setItem(PAINT_HINT_KEY, JSON.stringify(payload))
  } catch {
    // Best-effort mirror; the authoritative store is unaffected.
  }
}

/**
 * → the slot to paint, or null when the hint is unusable (absent, stale
 * version, missing token map) — null means "fall back to the legacy mode
 * hint", never an error.
 */
export function resolvePaintHint(
  hint: unknown,
  prefersDark: boolean,
): {
  tokens: Partial<ThemeTokens>
  mode: ThemeVariantMode
  presetId: string
  fontFamily: string | null
  fontSize: number
  reducedMotion: ReducedMotion
  pointerCursors: boolean
  windowEffects: boolean
} | null {
  if (!hint || typeof hint !== 'object') return null
  const h = hint as Partial<PaintHintPayload>
  if (h.v !== PAINT_HINT_VERSION) return null
  const mode = h.mode === 'system' ? (prefersDark ? 'dark' : 'light') : h.mode
  if (mode !== 'light' && mode !== 'dark') return null
  const tokens = h.slots?.[mode]
  if (!tokens || typeof tokens !== 'object') return null
  const presetId = h.presetId?.[mode]
  // Appearance fields degrade to defaults individually rather than
  // invalidating a hint whose colour half is still perfectly usable.
  return {
    tokens,
    mode,
    presetId: typeof presetId === 'string' && presetId ? presetId : 'default',
    fontFamily: typeof h.fontFamily === 'string' ? h.fontFamily : null,
    fontSize:
      typeof h.fontSize === 'number' && h.fontSize >= 12 && h.fontSize <= 20
        ? h.fontSize
        : 16,
    reducedMotion: isReducedMotion(h.reducedMotion)
      ? h.reducedMotion
      : 'system',
    pointerCursors: h.pointerCursors === true,
    // Additive field — a hint written before the vibrancy preference existed
    // degrades to opaque, matching the preference's default.
    windowEffects: h.windowEffects === true,
  }
}

/**
 * Called once before mount(), and again by the Quick Pane whenever the main
 * window broadcasts `theme-changed`. On any failure the stock palette (the
 * app.css fallbacks plus the legacy `.dark` toggle) simply shows until the
 * authoritative load reconciles.
 */
export function paintFromHint(
  target: HTMLElement = document.documentElement,
): void {
  let hint: unknown = null
  try {
    hint = JSON.parse(localStorage.getItem(PAINT_HINT_KEY) ?? 'null')
  } catch {
    // Corrupt payload — fall through to the legacy hint.
  }
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const resolved = resolvePaintHint(hint, prefersDark)
  if (resolved) {
    applyTokens(resolved.tokens, target)
    applyAppearanceTokens(resolved.fontFamily, resolved.fontSize, target)
    const prefersReduce = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
    applyDomState(
      resolved.presetId,
      resolved.mode,
      resolveReducedMotion(resolved.reducedMotion, prefersReduce),
      resolved.pointerCursors,
      resolved.windowEffects,
      target,
    )
    return
  }
  const stored = localStorage.getItem(THEME_STORAGE_KEY)
  const isDark = stored === 'dark' || (stored !== 'light' && prefersDark)
  target.classList.toggle('dark', isDark)
}
