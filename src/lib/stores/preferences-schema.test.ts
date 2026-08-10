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
  id: 'my-dracula',
  name: 'My Dracula',
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
      fontFamily: 'Georgia',
      fontSize: 14,
      reducedMotion: 'off',
      pointerCursors: true,
      language: 'en',
      globalShortcut: 'CommandOrControl+Shift+F',
      quickPaneShortcut: 'CommandOrControl+Shift+.',
      commandShortcuts: {
        'open-command-palette': 'mod+p',
        'toggle-theme': null,
      },
    }
    expect(sanitizePreferences(valid)).toEqual(valid)
  })

  it('sanitizes commandShortcuts entries individually', () => {
    const result = sanitizePreferences({
      theme: 'dark',
      commandShortcuts: {
        'custom-combo': 'Ctrl+Shift+K', // aliases normalise
        unbound: null,
        'no-modifier': 'k', // could never fire — dropped
        'modifier-only': 'mod+shift', // no key — dropped
        'wrong-type': 42, // dropped
        '': 'mod+j', // empty id — dropped
      },
    })
    expect(result.commandShortcuts).toEqual({
      'custom-combo': 'mod+shift+k',
      unbound: null,
    })
  })

  it('replaces a non-object commandShortcuts with an empty map', () => {
    expect(
      sanitizePreferences({ theme: 'dark', commandShortcuts: ['mod+k'] })
        .commandShortcuts,
    ).toEqual({})
    expect(
      sanitizePreferences({ theme: 'dark', commandShortcuts: 'mod+k' })
        .commandShortcuts,
    ).toEqual({})
    expect(sanitizePreferences({ theme: 'dark' }).commandShortcuts).toEqual({})
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

  it('drops an imported theme whose id collides with a built-in preset', () => {
    // Installed from the catalog before that theme was promoted to built-in:
    // the built-in replaces it, and the profile's presetId keeps resolving.
    const result = sanitizePreferences({
      theme: 'dark',
      darkProfile: validProfile,
      importedThemes: [
        { ...validImportedTheme, id: 'dracula-theme', name: 'Dracula Theme' },
        validImportedTheme,
      ],
    })
    expect(result.importedThemes).toEqual([validImportedTheme])
    expect(result.darkProfile.presetId).toBe('dracula-theme')
  })

  it('accepts valid appearance fields and rejects invalid ones', () => {
    const valid = sanitizePreferences({
      theme: 'dark',
      fontFamily: 'Georgia',
      fontSize: 18,
      reducedMotion: 'on',
      pointerCursors: true,
    })
    expect(valid.fontFamily).toBe('Georgia')
    expect(valid.fontSize).toBe(18)
    expect(valid.reducedMotion).toBe('on')
    expect(valid.pointerCursors).toBe(true)

    const invalid = sanitizePreferences({
      theme: 'dark',
      fontFamily: 42,
      fontSize: 99,
      reducedMotion: 'sometimes',
      pointerCursors: 'yes',
    })
    expect(invalid.fontFamily).toBeNull()
    expect(invalid.fontSize).toBe(16)
    expect(invalid.reducedMotion).toBe('system')
    expect(invalid.pointerCursors).toBe(false)
  })

  it('fills missing appearance fields from defaults', () => {
    // A pre-appearance-prefs preferences.json must load cleanly.
    const result = sanitizePreferences({ theme: 'dark' })
    expect(result.fontFamily).toBeNull()
    expect(result.fontSize).toBe(16)
    expect(result.reducedMotion).toBe('system')
    expect(result.pointerCursors).toBe(false)
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
