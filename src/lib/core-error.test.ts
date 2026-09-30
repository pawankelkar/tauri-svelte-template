import { describe, it, expect } from 'vitest'
import {
  describeCoreError,
  describeError,
  isCoreError,
  isCoreErrorKind,
} from './core-error'

describe('isCoreError', () => {
  it('recognises CoreError shapes only', () => {
    expect(isCoreError({ kind: 'offline', host: 'a.example' })).toBe(true)
    expect(isCoreError({ kind: 'bogus' })).toBe(false)
    expect(isCoreError(new Error('x'))).toBe(false)
    expect(isCoreError(null)).toBe(false)
  })
})

describe('isCoreErrorKind', () => {
  it('matches one kind of CoreError only', () => {
    const err: unknown = { kind: 'conflict', path: 'a.md' }
    expect(isCoreErrorKind(err, 'conflict')).toBe(true)
    expect(isCoreErrorKind(err, 'notFound')).toBe(false)
    expect(isCoreErrorKind({ kind: 'noVault' }, 'noVault')).toBe(true)
    expect(isCoreErrorKind('conflict', 'conflict')).toBe(false)
    if (isCoreErrorKind(err, 'conflict')) expect(err.path).toBe('a.md')
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

describe('describeCoreError for vault errors', () => {
  it('names the path or thing involved', () => {
    expect(describeCoreError({ kind: 'notFound', what: 'Inbox.md' })).toContain(
      'Inbox.md',
    )
    for (const kind of [
      'conflict',
      'pathOutsideVault',
      'alreadyExists',
    ] as const) {
      expect(describeCoreError({ kind, path: 'Notes/a.md' })).toContain(
        'Notes/a.md',
      )
    }
    expect(describeCoreError({ kind: 'noVault' })).toBe('No vault is open.')
  })
})

describe('describeError', () => {
  it('falls back through Error, string, and unknown values', () => {
    expect(describeError(new Error('broken'))).toBe('broken')
    expect(describeError('plain')).toBe('plain')
    expect(describeError(42)).toBe('Something went wrong.')
  })
})
