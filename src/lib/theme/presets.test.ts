import { describe, it, expect } from 'vitest'
import {
  BUILTIN_PRESETS,
  DEFAULT_LIGHT,
  DEFAULT_DARK,
  getPresetById,
  profileFromPreset,
  deriveTokensForProfile,
  mergeImportedPreset,
  presetContentEquals,
} from './presets'
import { validateThemePreset, type ThemePreset } from './schema'
import { CURATED_LIGHT_PRESETS, CURATED_DARK_PRESETS } from './builtin-presets'
import { loadCatalogTheme } from './vscode-catalog'

const userPreset = (patch: Partial<ThemePreset> = {}): ThemePreset => ({
  id: 'my-import',
  name: 'My Import',
  mode: 'dark',
  accent: '#5b8eef',
  background: '#17181c',
  foreground: '#e9eaed',
  contrast: 50,
  overrides: null,
  ...patch,
})

describe('built-in presets', () => {
  it('ships the Default pair plus the curated set, all valid', () => {
    expect(BUILTIN_PRESETS[0]).toBe(DEFAULT_LIGHT)
    expect(BUILTIN_PRESETS[1]).toBe(DEFAULT_DARK)
    expect(CURATED_LIGHT_PRESETS).toHaveLength(5)
    expect(CURATED_DARK_PRESETS).toHaveLength(6)
    expect(BUILTIN_PRESETS).toHaveLength(13)
    expect(BUILTIN_PRESETS.filter((p) => p.mode === 'light')).toHaveLength(6)
    expect(BUILTIN_PRESETS.filter((p) => p.mode === 'dark')).toHaveLength(7)
    for (const preset of BUILTIN_PRESETS) {
      expect(validateThemePreset(preset), preset.id).toEqual([])
    }
    expect(new Set(BUILTIN_PRESETS.map((p) => p.id)).size).toBe(13)
    expect(DEFAULT_LIGHT.mode).toBe('light')
    expect(DEFAULT_DARK.mode).toBe('dark')
  })

  it('curated built-ins match a fresh catalog conversion (no drift)', async () => {
    for (const preset of [...CURATED_LIGHT_PRESETS, ...CURATED_DARK_PRESETS]) {
      const fresh = await loadCatalogTheme(preset.id)
      expect(fresh.error, preset.id).toBeUndefined()
      expect(fresh.preset, preset.id).toEqual(preset)
    }
  })

  it('the Default light preset reproduces the stock palette', () => {
    const tokens = deriveTokensForProfile(
      profileFromPreset(DEFAULT_LIGHT),
      'light',
    )
    expect(tokens['bg-base']).toBe('#ffffff')
    expect(tokens['bg-surface']).toBe('#fafafa')
    expect(tokens.border).toBe('#e5e5e5')
    expect(tokens['text-muted']).toBe('#737373')
    expect(tokens.danger).toBe('#e7000b')
  })
})

describe('getPresetById', () => {
  it('finds built-ins and user presets, built-ins first on collision', () => {
    expect(getPresetById('default-light')?.id).toBe('default-light')
    expect(getPresetById('nope')).toBeNull()
    expect(getPresetById('my-import', [userPreset()])?.name).toBe('My Import')
    const rogue = userPreset({ id: 'default-dark', name: 'Rogue' })
    expect(getPresetById('default-dark', [rogue])?.name).toBe('Default Dark')
  })
})

describe('deriveTokensForProfile', () => {
  const preset = userPreset({ overrides: { 'bg-surface': '#252536' } })

  it('applies the preset overrides while uncustomized', () => {
    const tokens = deriveTokensForProfile(profileFromPreset(preset), 'dark', [
      preset,
    ])
    expect(tokens['bg-surface']).toBe('#252536')
  })

  it('derives from anchors alone once customized or when the preset is gone', () => {
    const customized = { ...profileFromPreset(preset), customized: true }
    expect(
      deriveTokensForProfile(customized, 'dark', [preset])['bg-surface'],
    ).not.toBe('#252536')
    // Preset deleted: same anchors-only derivation, no crash.
    expect(
      deriveTokensForProfile(profileFromPreset(preset), 'dark', [])[
        'bg-surface'
      ],
    ).not.toBe('#252536')
  })
})

describe('mergeImportedPreset', () => {
  it('keeps a fresh id and suffixes collisions with built-ins and users', () => {
    expect(mergeImportedPreset(userPreset(), []).id).toBe('my-import')
    const suffixed = mergeImportedPreset(userPreset(), [userPreset()])
    expect(suffixed.id).toBe('my-import-2')
    expect(suffixed.name).toBe('My Import (2)')
    expect(mergeImportedPreset(userPreset({ id: 'default-dark' }), []).id).toBe(
      'default-dark-2',
    )
  })
})

describe('presetContentEquals', () => {
  it('matches on colors regardless of id, differs on any anchor', () => {
    const a = userPreset()
    expect(presetContentEquals(a, userPreset({ id: 'other', name: 'X' }))).toBe(
      true,
    )
    expect(presetContentEquals(a, userPreset({ accent: '#ffffff' }))).toBe(
      false,
    )
    expect(
      presetContentEquals(a, userPreset({ overrides: { border: '#000000' } })),
    ).toBe(false)
  })
})
