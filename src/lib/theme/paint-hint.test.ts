import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  paintFromHint,
  resolvePaintHint,
  writePaintHint,
  THEME_STORAGE_KEY,
  PAINT_HINT_KEY,
  PAINT_HINT_VERSION,
  type PaintHintPayload,
} from './paint-hint'

const payload = (
  overrides: Partial<PaintHintPayload> = {},
): PaintHintPayload => ({
  v: PAINT_HINT_VERSION,
  mode: 'dark',
  presetId: { light: 'default-light', dark: 'dracula-theme' },
  slots: {
    light: { 'bg-base': '#ffffff' },
    dark: { 'bg-base': '#282a36' },
  },
  fontFamily: null,
  fontSize: 16,
  reducedMotion: 'system',
  pointerCursors: false,
  windowEffects: false,
  ...overrides,
})

let prefersDark = false

beforeEach(() => {
  localStorage.removeItem(THEME_STORAGE_KEY)
  localStorage.removeItem(PAINT_HINT_KEY)
  document.documentElement.classList.remove('dark')
  document.documentElement.removeAttribute('style')
  document.documentElement.removeAttribute('data-color-mode')
  document.documentElement.removeAttribute('data-theme-preset')
  document.documentElement.removeAttribute('data-reduced-motion')
  document.documentElement.removeAttribute('data-cursor')
  document.documentElement.removeAttribute('data-window-effects')
  prefersDark = false
  vi.spyOn(window, 'matchMedia').mockImplementation(
    () => ({ matches: prefersDark }) as MediaQueryList,
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('resolvePaintHint', () => {
  it('resolves the slot for the stored mode', () => {
    const resolved = resolvePaintHint(payload(), false)
    expect(resolved?.tokens['bg-base']).toBe('#282a36')
    expect(resolved?.mode).toBe('dark')
    expect(resolved?.presetId).toBe('dracula-theme')
  })

  it('resolves system mode from the OS preference at paint time', () => {
    expect(
      resolvePaintHint(payload({ mode: 'system' }), false)?.tokens['bg-base'],
    ).toBe('#ffffff')
    expect(
      resolvePaintHint(payload({ mode: 'system' }), true)?.tokens['bg-base'],
    ).toBe('#282a36')
  })

  it('rejects unusable hints instead of throwing', () => {
    expect(resolvePaintHint(null, false)).toBeNull()
    expect(resolvePaintHint('junk', false)).toBeNull()
    expect(resolvePaintHint({ v: 999 }, false)).toBeNull()
    // A pre-appearance v2 hint is stale under the current version.
    expect(resolvePaintHint(payload({ v: 2 }), false)).toBeNull()
    expect(
      resolvePaintHint(payload({ slots: undefined as never }), false),
    ).toBeNull()
  })

  it('passes appearance fields through, degrading bad ones individually', () => {
    const resolved = resolvePaintHint(
      payload({
        fontFamily: 'Cascadia Code',
        fontSize: 18,
        reducedMotion: 'on',
        pointerCursors: true,
        windowEffects: true,
      }),
      false,
    )
    expect(resolved?.fontFamily).toBe('Cascadia Code')
    expect(resolved?.fontSize).toBe(18)
    expect(resolved?.reducedMotion).toBe('on')
    expect(resolved?.pointerCursors).toBe(true)
    expect(resolved?.windowEffects).toBe(true)

    const degraded = resolvePaintHint(
      payload({
        fontFamily: 42 as never,
        fontSize: 99,
        reducedMotion: 'sometimes' as never,
        pointerCursors: 'yes' as never,
        windowEffects: 'yes' as never,
      }),
      false,
    )
    expect(degraded?.tokens['bg-base']).toBe('#282a36')
    expect(degraded?.fontFamily).toBeNull()
    expect(degraded?.fontSize).toBe(16)
    expect(degraded?.reducedMotion).toBe('system')
    expect(degraded?.pointerCursors).toBe(false)
    expect(degraded?.windowEffects).toBe(false)
  })
})

describe('paintFromHint', () => {
  it('paints tokens and dom state from a stored payload', () => {
    writePaintHint(payload())
    paintFromHint()
    const root = document.documentElement
    expect(root.style.getPropertyValue('--sd-bg-base')).toBe('#282a36')
    expect(root.classList.contains('dark')).toBe(true)
    expect(root.getAttribute('data-theme-preset')).toBe('dracula-theme')
  })

  it('paints appearance state from a stored payload', () => {
    writePaintHint(
      payload({ fontFamily: 'Georgia', fontSize: 14, pointerCursors: true }),
    )
    paintFromHint()
    const root = document.documentElement
    expect(root.style.getPropertyValue('--sd-font-ui')).toContain('Georgia')
    expect(root.style.getPropertyValue('--sd-font-size')).toBe('14px')
    expect(root.getAttribute('data-cursor')).toBe('pointer')
    // reducedMotion 'system' with the mocked matchMedia (matches: false).
    expect(root.getAttribute('data-reduced-motion')).toBe('false')
  })

  it('paints the light slot in light mode', () => {
    writePaintHint(payload({ mode: 'light' }))
    paintFromHint()
    const root = document.documentElement
    expect(root.style.getPropertyValue('--sd-bg-base')).toBe('#ffffff')
    expect(root.classList.contains('dark')).toBe(false)
    expect(root.getAttribute('data-theme-preset')).toBe('default-light')
  })

  it('falls back to the legacy mode hint when no payload exists', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    paintFromHint()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(
      document.documentElement.style.getPropertyValue('--sd-bg-base'),
    ).toBe('')
  })

  it('survives a corrupt payload via the legacy fallback', () => {
    localStorage.setItem(PAINT_HINT_KEY, '{not json')
    localStorage.setItem(THEME_STORAGE_KEY, 'light')
    prefersDark = true
    paintFromHint()
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('follows the OS for system mode with no stored hints', () => {
    prefersDark = true
    paintFromHint()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})
