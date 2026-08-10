import { describe, it, expect } from 'vitest'
import { SYSTEM_FONT_FALLBACK, uiFontStack } from './fonts'

describe('uiFontStack', () => {
  it('returns the bare fallback stack for null or blank input', () => {
    expect(uiFontStack(null)).toBe(SYSTEM_FONT_FALLBACK)
    expect(uiFontStack('   ')).toBe(SYSTEM_FONT_FALLBACK)
  })

  it('prepends a single-word family unquoted', () => {
    expect(uiFontStack('Georgia')).toBe(`Georgia, ${SYSTEM_FONT_FALLBACK}`)
  })

  it('quotes multi-word families and escapes quotes', () => {
    expect(uiFontStack('Cascadia Code')).toBe(
      `'Cascadia Code', ${SYSTEM_FONT_FALLBACK}`,
    )
    expect(uiFontStack("O'Brien Sans")).toBe(
      `'O\\'Brien Sans', ${SYSTEM_FONT_FALLBACK}`,
    )
  })
})
