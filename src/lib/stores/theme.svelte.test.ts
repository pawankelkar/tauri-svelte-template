import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockIPC } from '@tauri-apps/api/mocks'
import {
  initTheme,
  setThemeMode,
  reconcileTheme,
  getResolvedMode,
  getThemeMode,
} from './theme.svelte'
import { initPreferences, __resetPreferencesForTests } from './preferences.svelte'
import { defaultPreferences } from './preferences-schema'
import { THEME_STORAGE_KEY } from '$lib/theme/paint-hint'

vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn(),
  listen: vi.fn(() => Promise.resolve(() => {})),
}))

let matchMediaCallback: ((e: { matches: boolean }) => void) | null = null
let matchMediaMatches = false

beforeEach(() => {
  __resetPreferencesForTests()
  localStorage.removeItem(THEME_STORAGE_KEY)
  document.documentElement.classList.remove('dark')
  matchMediaCallback = null
  matchMediaMatches = false

  vi.spyOn(window, 'matchMedia').mockImplementation(
    () =>
      ({
        matches: matchMediaMatches,
        addEventListener: (
          _: string,
          cb: (e: { matches: boolean }) => void,
        ) => {
          matchMediaCallback = cb
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
})

describe('system mode matchMedia', () => {
  it('repaints on OS change when mode is system', async () => {
    await initPreferences()
    initTheme()
    setThemeMode('system')

    expect(matchMediaCallback).not.toBeNull()
    matchMediaCallback!({ matches: true })
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    matchMediaCallback!({ matches: false })
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
    matchMediaCallback!({ matches: true })

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
    matchMediaCallback!({ matches: true })

    expect(emit).not.toHaveBeenCalled()
  })
})
