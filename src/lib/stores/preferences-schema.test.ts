import { describe, it, expect } from 'vitest'
import {
  defaultPreferences,
  sanitizePreferences,
  isThemeMode,
} from './preferences-schema'

describe('isThemeMode', () => {
  it('accepts valid modes', () => {
    expect(isThemeMode('light')).toBe(true)
    expect(isThemeMode('dark')).toBe(true)
    expect(isThemeMode('system')).toBe(true)
  })

  it('rejects invalid values', () => {
    expect(isThemeMode('blue')).toBe(false)
    expect(isThemeMode('')).toBe(false)
    expect(isThemeMode(42)).toBe(false)
    expect(isThemeMode(null)).toBe(false)
  })
})

const validImportedTheme = {
  id: 'dracula-theme',
  name: 'Dracula Theme',
  mode: 'dark',
  accent: '#ff79c6',
  background: '#282a36',
  foreground: '#f8f8f2',
  contrast: 50,
  overrides: null,
}

const validProfile = {
  presetId: 'dracula-theme',
  customized: false,
  accent: '#ff79c6',
  background: '#282a36',
  foreground: '#f8f8f2',
  contrast: 50,
}

describe('sanitizePreferences', () => {
  it('passes through a valid object unchanged', () => {
    const valid = {
      theme: 'dark',
      lightProfile: { ...validProfile, presetId: 'default-light' },
      darkProfile: validProfile,
      importedThemes: [validImportedTheme],
      language: 'en',
      globalShortcut: 'CommandOrControl+Shift+F',
      quickPaneShortcut: 'CommandOrControl+Shift+.',
    }
    expect(sanitizePreferences(valid)).toEqual(valid)
  })

  it('fills missing theme-system fields from defaults', () => {
    // A pre-theme-system preferences.json must load cleanly.
    const result = sanitizePreferences({ theme: 'dark' })
    expect(result.lightProfile.presetId).toBe('default-light')
    expect(result.darkProfile.presetId).toBe('default-dark')
    expect(result.importedThemes).toEqual([])
  })

  it('replaces a structurally broken profile with the default', () => {
    const result = sanitizePreferences({
      theme: 'dark',
      lightProfile: { ...validProfile, background: 'nope' },
      darkProfile: { ...validProfile, contrast: 500 },
    })
    expect(result.lightProfile.presetId).toBe('default-light')
    expect(result.darkProfile.presetId).toBe('default-dark')
  })

  it('drops structurally invalid imported themes and keeps valid ones', () => {
    const result = sanitizePreferences({
      theme: 'dark',
      importedThemes: [
        validImportedTheme,
        { ...validImportedTheme, id: '', name: 'Broken' },
        { ...validImportedTheme, mode: 'auto' },
        'garbage',
      ],
    })
    expect(result.importedThemes).toEqual([validImportedTheme])
  })

  it('returns defaults for null', () => {
    expect(sanitizePreferences(null)).toEqual(defaultPreferences())
  })

  it('returns defaults for non-object', () => {
    expect(sanitizePreferences('string')).toEqual(defaultPreferences())
    expect(sanitizePreferences(42)).toEqual(defaultPreferences())
  })

  it('returns defaults for array', () => {
    expect(sanitizePreferences([1, 2])).toEqual(defaultPreferences())
  })

  it('falls back theme to system on invalid string', () => {
    const result = sanitizePreferences({ theme: 'blue', language: 'fr' })
    expect(result.theme).toBe('system')
    expect(result.language).toBe('fr')
  })

  it('falls back theme to system on wrong type', () => {
    const result = sanitizePreferences({ theme: 42, language: 'en' })
    expect(result.theme).toBe('system')
    expect(result.language).toBe('en')
  })

  it('falls back non-string optional fields to null', () => {
    const result = sanitizePreferences({
      theme: 'light',
      language: 123,
      globalShortcut: true,
      quickPaneShortcut: {},
    })
    expect(result.theme).toBe('light')
    expect(result.language).toBeNull()
    expect(result.globalShortcut).toBeNull()
    expect(result.quickPaneShortcut).toBeNull()
  })
})
