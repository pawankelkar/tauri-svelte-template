import { describe, it, expect } from 'vitest'
import { describeCoreError, describeError, isCoreError } from './core-error'

describe('isCoreError', () => {
  it('recognises CoreError shapes only', () => {
    expect(isCoreError({ kind: 'offline', host: 'a.example' })).toBe(true)
    expect(isCoreError({ kind: 'bogus' })).toBe(false)
    expect(isCoreError(new Error('x'))).toBe(false)
    expect(isCoreError(null)).toBe(false)
  })
})

describe('describeCoreError', () => {
  it('names the host for offline and allowlist errors', () => {
    expect(describeCoreError({ kind: 'offline', host: 'a.example' })).toContain(
      'a.example',
    )
    expect(
      describeCoreError({ kind: 'hostNotAllowed', host: 'b.example' }),
    ).toContain('b.example')
  })

  it('uses the translated feature name for notEntitled', () => {
    expect(
      describeCoreError({ kind: 'notEntitled', feature: 'pdfAiQa' }),
    ).toContain('PDF Q&A')
  })

  it('carries the message for message-bearing kinds', () => {
    for (const kind of ['network', 'invalidInput', 'internal'] as const) {
      expect(describeCoreError({ kind, message: 'detail' })).toContain('detail')
    }
  })
})

describe('describeError', () => {
  it('falls back through Error, string, and unknown values', () => {
    expect(describeError(new Error('broken'))).toBe('broken')
    expect(describeError('plain')).toBe('plain')
    expect(describeError(42)).toBe('Something went wrong.')
  })
})
