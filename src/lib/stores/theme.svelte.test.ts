import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockIPC } from '@tauri-apps/api/mocks'
import {
  initTheme,
  setThemeMode,
  setPreset,
  setAnchors,
  canResetProfile,
  resetProfileToPreset,
  registerUserPreset,
  deleteUserPreset,
  getProfile,
  getUserPresets,
  reconcileTheme,
  getResolvedMode,
  getThemeMode,
  setFontFamily,
  setFontSize,
  setReducedMotion,
  setPointerCursors,
} from './theme.svelte'
import {
  initPreferences,
  __resetPreferencesForTests,
} from './preferences.svelte'
import { defaultPreferences } from './preferences-schema'
import {
  THEME_STORAGE_KEY,
  PAINT_HINT_KEY,
  PAINT_HINT_VERSION,
  type PaintHintPayload,
} from '$lib/theme/paint-hint'
import type { ThemePreset } from '$lib/theme/schema'

vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn(),
  listen: vi.fn(() => Promise.resolve(() => {})),
}))

// initTheme registers one listener per media query (color scheme and
// reduced motion), so callbacks are keyed by the query string.
let matchMediaCallbacks: Record<string, (e: { matches: boolean }) => void> = {}
let matchMediaMatches = false
const darkSchemeChange = (e: { matches: boolean }): void =>
  matchMediaCallbacks['(prefers-color-scheme: dark)']?.(e)

beforeEach(() => {
  __resetPreferencesForTests()
  localStorage.removeItem(THEME_STORAGE_KEY)
  localStorage.removeItem(PAINT_HINT_KEY)
  document.documentElement.classList.remove('dark')
  document.documentElement.removeAttribute('style')
  document.documentElement.removeAttribute('data-color-mode')
  document.documentElement.removeAttribute('data-theme-preset')
  document.documentElement.removeAttribute('data-reduced-motion')
  document.documentElement.removeAttribute('data-cursor')
  matchMediaCallbacks = {}
  matchMediaMatches = false

  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: matchMediaMatches,
        addEventListener: (
          _: string,
          cb: (e: { matches: boolean }) => void,
        ) => {
          matchMediaCallbacks[query] = cb
        },
        removeEventListener: vi.fn(),
      }) as unknown as MediaQueryList,
  )

  mockIPC((cmd) => {
    if (cmd === 'load_preferences') return defaultPreferences()
    if (cmd === 'save_preferences') return null
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

const dracula = (): ThemePreset => ({
  id: 'my-dracula',
  name: 'My Dracula',
  mode: 'dark',
  accent: '#ff79c6',
  background: '#282a36',
  foreground: '#f8f8f2',
  contrast: 50,
  overrides: { 'bg-base': '#282a36', 'bg-surface': '#21222c' },
})

describe('initTheme', () => {
  it('returns a cleanup function', async () => {
    await initPreferences()
    const cleanup = initTheme()
    expect(typeof cleanup).toBe('function')
    cleanup()
  })
})

describe('setThemeMode', () => {
  it('applies dark class and syncs localStorage', async () => {
    await initPreferences()
    initTheme()

    setThemeMode('dark')

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(getThemeMode()).toBe('dark')
    expect(getResolvedMode()).toBe('dark')
  })

  it('removes dark class for light mode', async () => {
    await initPreferences()
    initTheme()

    setThemeMode('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    setThemeMode('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
  })

  it('paints the mode slot tokens and stamps dom state', async () => {
    await initPreferences()
    initTheme()

    setThemeMode('dark')

    const root = document.documentElement
    expect(root.style.getPropertyValue('--sd-bg-base')).toBe('#0a0a0a')
    expect(root.getAttribute('data-color-mode')).toBe('dark')
    expect(root.getAttribute('data-theme-preset')).toBe('default-dark')

    setThemeMode('light')
    expect(root.style.getPropertyValue('--sd-bg-base')).toBe('#ffffff')
    expect(root.getAttribute('data-theme-preset')).toBe('default-light')
  })

  it('emits theme-changed event', async () => {
    const { emit } = await import('@tauri-apps/api/event')
    await initPreferences()
    initTheme()

    setThemeMode('dark')

    expect(emit).toHaveBeenCalledWith('theme-changed', {
      mode: 'dark',
      resolved: 'dark',
    })
  })

  it('reports the resolved theme alongside the mode', async () => {
    // Other windows repaint from the resolved value; 'system' alone would not
    // tell them which way to paint.
    const { emit } = await import('@tauri-apps/api/event')
    matchMediaMatches = true
    await initPreferences()
    initTheme()

    setThemeMode('system')

    expect(emit).toHaveBeenCalledWith('theme-changed', {
      mode: 'system',
      resolved: 'dark',
    })
  })
})

describe('reconcileTheme', () => {
  it('repaints without emitting', async () => {
    const { emit } = await import('@tauri-apps/api/event')
    await initPreferences()
    initTheme()

    vi.mocked(emit).mockClear()
    reconcileTheme()

    expect(emit).not.toHaveBeenCalled()
  })

  it('applies class based on current preferences', async () => {
    mockIPC((cmd) => {
      if (cmd === 'load_preferences')
        return { ...defaultPreferences(), theme: 'dark' }
      if (cmd === 'save_preferences') return null
    })

    await initPreferences()
    initTheme()
    reconcileTheme()

    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('writes a paint hint carrying both mode slots', async () => {
    await initPreferences()
    initTheme()
    reconcileTheme()

    const hint = JSON.parse(
      localStorage.getItem(PAINT_HINT_KEY)!,
    ) as PaintHintPayload
    expect(hint.v).toBe(PAINT_HINT_VERSION)
    expect(hint.presetId).toEqual({
      light: 'default-light',
      dark: 'default-dark',
    })
    expect(hint.slots.light['bg-base']).toBe('#ffffff')
    expect(hint.slots.dark['bg-base']).toBe('#0a0a0a')
  })
})

describe('presets and profiles', () => {
  it('setPreset repoints a slot and paints it when live', async () => {
    await initPreferences()
    initTheme()
    setThemeMode('dark')

    registerUserPreset(dracula())
    setPreset('dark', 'my-dracula')

    expect(getProfile('dark').presetId).toBe('my-dracula')
    expect(getProfile('dark').customized).toBe(false)
    expect(
      document.documentElement.style.getPropertyValue('--sd-bg-base'),
    ).toBe('#282a36')
    // The light slot is untouched.
    expect(getProfile('light').presetId).toBe('default-light')
  })

  it('ignores an unknown preset id', async () => {
    await initPreferences()
    initTheme()

    setPreset('dark', 'nope')
    expect(getProfile('dark').presetId).toBe('default-dark')
  })

  it('setAnchors marks the profile customized and drops preset overrides', async () => {
    await initPreferences()
    initTheme()
    setThemeMode('dark')
    registerUserPreset(dracula())
    setPreset('dark', 'my-dracula')
    expect(
      document.documentElement.style.getPropertyValue('--sd-bg-surface'),
    ).toBe('#21222c')

    setAnchors('dark', { accent: '#00b0ff' })

    expect(getProfile('dark').customized).toBe(true)
    expect(getProfile('dark').accent).toBe('#00b0ff')
    // Overrides no longer apply: bg-surface re-derives from anchors.
    expect(
      document.documentElement.style.getPropertyValue('--sd-bg-surface'),
    ).not.toBe('#21222c')
  })

  it('clamps contrast and resets back to the preset', async () => {
    await initPreferences()
    initTheme()

    expect(canResetProfile('dark')).toBe(false)
    setAnchors('dark', { contrast: 300 })
    expect(getProfile('dark').contrast).toBe(100)
    expect(canResetProfile('dark')).toBe(true)

    resetProfileToPreset('dark')
    expect(getProfile('dark').customized).toBe(false)
    expect(getProfile('dark').contrast).toBe(50)
  })
})

describe('user presets', () => {
  it('registers, dedupes identical content, and suffixes colliding ids', async () => {
    await initPreferences()
    initTheme()

    const first = registerUserPreset(dracula())
    expect(first.already).toBe(false)
    expect(first.preset.id).toBe('my-dracula')

    const again = registerUserPreset(dracula())
    expect(again.already).toBe(true)
    expect(getUserPresets()).toHaveLength(1)

    const recolored = registerUserPreset({
      ...dracula(),
      accent: '#00b0ff',
    })
    expect(recolored.preset.id).toBe('my-dracula-2')
    expect(recolored.preset.name).toBe('My Dracula (2)')
  })

  it('a colliding built-in id gets suffixed', async () => {
    await initPreferences()
    initTheme()

    const stored = registerUserPreset({ ...dracula(), id: 'default-dark' })
    expect(stored.preset.id).toBe('default-dark-2')
  })

  it('deleting a preset keeps the profile anchors but drops its overrides', async () => {
    await initPreferences()
    initTheme()
    setThemeMode('dark')
    registerUserPreset(dracula())
    setPreset('dark', 'my-dracula')

    deleteUserPreset('my-dracula')

    expect(getUserPresets()).toHaveLength(0)
    // Colors survive via the profile's own anchors...
    expect(getProfile('dark').background).toBe('#282a36')
    expect(
      document.documentElement.style.getPropertyValue('--sd-bg-base'),
    ).toBe('#282a36')
    // ...but the preset's pinned surface no longer applies.
    expect(
      document.documentElement.style.getPropertyValue('--sd-bg-surface'),
    ).not.toBe('#21222c')
  })
})

describe('system mode matchMedia', () => {
  it('repaints on OS change when mode is system', async () => {
    await initPreferences()
    initTheme()
    setThemeMode('system')

    expect(matchMediaCallbacks['(prefers-color-scheme: dark)']).toBeDefined()
    darkSchemeChange({ matches: true })
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    darkSchemeChange({ matches: false })
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('emits on OS change so other windows follow', async () => {
    // No preference changed here, but the resolved theme did — and the Quick
    // Pane has no matchMedia listener of its own while it is hidden.
    const { emit } = await import('@tauri-apps/api/event')
    await initPreferences()
    initTheme()
    setThemeMode('system')

    vi.mocked(emit).mockClear()
    darkSchemeChange({ matches: true })

    expect(emit).toHaveBeenCalledWith('theme-changed', {
      mode: 'system',
      resolved: 'dark',
    })
  })

  it('does not emit on OS change when the mode is not system', async () => {
    const { emit } = await import('@tauri-apps/api/event')
    await initPreferences()
    initTheme()
    setThemeMode('light')

    vi.mocked(emit).mockClear()
    darkSchemeChange({ matches: true })

    expect(emit).not.toHaveBeenCalled()
  })
})

describe('appearance preferences', () => {
  it('setters persist and stamp the root element', async () => {
    await initPreferences()
    initTheme()
    const root = document.documentElement

    setFontFamily('Cascadia Code')
    expect(root.style.getPropertyValue('--sd-font-ui')).toContain(
      "'Cascadia Code'",
    )

    setFontSize(18)
    expect(root.style.getPropertyValue('--sd-font-size')).toBe('18px')
    // Clamped to the valid range.
    setFontSize(99)
    expect(root.style.getPropertyValue('--sd-font-size')).toBe('20px')

    setReducedMotion('on')
    expect(root.getAttribute('data-reduced-motion')).toBe('true')
    setReducedMotion('off')
    expect(root.getAttribute('data-reduced-motion')).toBe('false')

    setPointerCursors(true)
    expect(root.getAttribute('data-cursor')).toBe('pointer')

    // Everything lands in the paint hint for the next launch.
    const hint = JSON.parse(
      localStorage.getItem(PAINT_HINT_KEY) ?? 'null',
    ) as PaintHintPayload
    expect(hint.fontFamily).toBe('Cascadia Code')
    expect(hint.fontSize).toBe(20)
    expect(hint.reducedMotion).toBe('off')
    expect(hint.pointerCursors).toBe(true)
  })

  it('an OS reduced-motion flip repaints only under the system preference', async () => {
    await initPreferences()
    initTheme()
    const root = document.documentElement
    const motionChange = matchMediaCallbacks['(prefers-reduced-motion: reduce)']
    if (!motionChange) throw new Error('reduced-motion listener not registered')

    reconcileTheme()
    expect(root.getAttribute('data-reduced-motion')).toBe('false')
    motionChange({ matches: true })
    expect(root.getAttribute('data-reduced-motion')).toBe('true')

    setReducedMotion('off')
    motionChange({ matches: false })
    // Explicit 'off' ignores the OS.
    expect(root.getAttribute('data-reduced-motion')).toBe('false')
  })
})
