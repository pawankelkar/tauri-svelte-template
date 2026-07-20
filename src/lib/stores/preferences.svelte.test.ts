import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockIPC } from '@tauri-apps/api/mocks'
import {
  initPreferences,
  getPreferences,
  isPreferencesReady,
  setPreference,
  setPreferenceImmediate,
  persistPreferencesNow,
  __resetPreferencesForTests,
} from './preferences.svelte'
import { defaultPreferences } from './preferences-schema'

beforeEach(() => {
  __resetPreferencesForTests()
  vi.useRealTimers()
})

describe('initPreferences', () => {
  it('loads preferences from backend and flips ready', async () => {
    mockIPC((cmd) => {
      if (cmd === 'load_preferences') {
        return {
          theme: 'dark',
          language: 'fr',
          globalShortcut: null,
          quickPaneShortcut: null,
        }
      }
    })

    const result = await initPreferences()
    expect(isPreferencesReady()).toBe(true)
    expect(result.theme).toBe('dark')
    expect(result.language).toBe('fr')
    expect(getPreferences().theme).toBe('dark')
  })

  it('falls back to defaults on load error', async () => {
    mockIPC((cmd) => {
      if (cmd === 'load_preferences') {
        throw new Error('backend error')
      }
    })

    await initPreferences()
    expect(isPreferencesReady()).toBe(true)
    expect(getPreferences()).toEqual(defaultPreferences())
  })

  it('sanitizes invalid theme values from backend', async () => {
    mockIPC((cmd) => {
      if (cmd === 'load_preferences') {
        return {
          theme: 'invalid',
          language: 'en',
          globalShortcut: null,
          quickPaneShortcut: null,
        }
      }
    })

    await initPreferences()
    expect(getPreferences().theme).toBe('system')
    expect(getPreferences().language).toBe('en')
  })
})

describe('setPreference', () => {
  it('updates the preference and schedules a debounced save', async () => {
    vi.useFakeTimers()
    const saveCalls: unknown[] = []

    mockIPC((cmd, args) => {
      if (cmd === 'load_preferences') {
        return defaultPreferences()
      }
      if (cmd === 'save_preferences') {
        saveCalls.push(args)
        return null
      }
    })

    await initPreferences()
    setPreference('theme', 'dark')
    expect(getPreferences().theme).toBe('dark')

    expect(saveCalls).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(500)
    expect(saveCalls).toHaveLength(1)
  })
})

describe('persistPreferencesNow', () => {
  it('flushes immediately without waiting for debounce', async () => {
    vi.useFakeTimers()
    const saveCalls: unknown[] = []

    mockIPC((cmd, args) => {
      if (cmd === 'load_preferences') {
        return defaultPreferences()
      }
      if (cmd === 'save_preferences') {
        saveCalls.push(args)
        return null
      }
    })

    await initPreferences()
    setPreference('theme', 'light')
    await persistPreferencesNow()
    expect(saveCalls).toHaveLength(1)
  })
})

describe('setPreferenceImmediate', () => {
  it('saves without waiting for the debounce', async () => {
    vi.useFakeTimers()
    const saveCalls: unknown[] = []

    mockIPC((cmd, args) => {
      if (cmd === 'load_preferences') return defaultPreferences()
      if (cmd === 'save_preferences') {
        saveCalls.push(args)
        return null
      }
    })

    await initPreferences()
    await setPreferenceImmediate('globalShortcut', 'CmdOrCtrl+K')

    expect(saveCalls).toHaveLength(1)
    expect(getPreferences().globalShortcut).toBe('CmdOrCtrl+K')
  })

  it('restores the previous value and rethrows when the save fails', async () => {
    mockIPC((cmd) => {
      if (cmd === 'load_preferences') {
        return { ...defaultPreferences(), globalShortcut: 'CmdOrCtrl+K' }
      }
      if (cmd === 'save_preferences') throw new Error('disk full')
    })

    await initPreferences()

    await expect(
      setPreferenceImmediate('globalShortcut', 'CmdOrCtrl+Shift+P'),
    ).rejects.toThrow()
    expect(getPreferences().globalShortcut).toBe('CmdOrCtrl+K')
  })
})
