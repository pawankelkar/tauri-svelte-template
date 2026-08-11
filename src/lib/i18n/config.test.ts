import { describe, it, expect } from 'vitest'
import { availableLanguages, languageLabels, isRTL } from './config'
import en from '../../../locales/en.json'
import fr from '../../../locales/fr.json'

describe('i18n config', () => {
  it('has a display label for every registered language', () => {
    // The language picker falls back to the raw code without a label, so this
    // guards the "adding a locale is a one-file change" contract.
    for (const code of availableLanguages) {
      expect(languageLabels[code], `missing label for "${code}"`).toBeTruthy()
    }
  })

  it('does not carry labels for languages that are not registered', () => {
    for (const code of Object.keys(languageLabels)) {
      expect(availableLanguages, `stale label for "${code}"`).toContain(code)
    }
  })

  it('flags right-to-left languages', () => {
    expect(isRTL('ar')).toBe(true)
    expect(isRTL('en')).toBe(false)
  })

  it('keeps every locale file in key parity with en.json', () => {
    // A locale that drifts from en.json silently falls back key-by-key,
    // which reads as a half-translated UI. Fail loudly instead.
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort())
  })
})
