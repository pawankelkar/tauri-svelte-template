import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('$lib/logger', () => ({
  warn: vi.fn(),
  logger: { warn: vi.fn() },
}))

import { warn } from '$lib/logger'
import {
  setContextKey,
  getContextKey,
  resetContextKeys,
  evaluateWhen,
  parseWhen,
  whenSpecificity,
} from './context-keys.svelte'

describe('context key store', () => {
  beforeEach(() => resetContextKeys())

  it('stores and returns values', () => {
    setContextKey('mode', 'dark')
    expect(getContextKey('mode')).toBe('dark')
  })

  it('can be set while Svelte is mid-update', () => {
    // As when `focusout` fires while a block removes a focused editor.
    const cleanup = $effect.root(() => {
      const value = $derived.by(() => {
        setContextKey('editorFocus', false)
        return 1
      })
      expect(value).toBe(1)
    })
    cleanup()
    expect(getContextKey('editorFocus')).toBe(false)
  })

  it('resetContextKeys forgets everything', () => {
    setContextKey('offline', true)
    resetContextKeys()
    expect(getContextKey('offline')).toBeUndefined()
  })
})

describe('parseWhen', () => {
  it('binds ! tighter than &&, and && tighter than ||', () => {
    expect(parseWhen('!a && b || c')).toEqual({
      type: 'or',
      left: {
        type: 'and',
        left: { type: 'not', operand: { type: 'key', key: 'a' } },
        right: { type: 'key', key: 'b' },
      },
      right: { type: 'key', key: 'c' },
    })
  })

  it('binds == tighter than &&', () => {
    expect(parseWhen("a == 'x' && b")).toEqual({
      type: 'and',
      left: { type: 'eq', key: 'a', value: 'x' },
      right: { type: 'key', key: 'b' },
    })
  })

  it('parses number and boolean literals', () => {
    expect(parseWhen('count != 3')).toEqual({
      type: 'ne',
      key: 'count',
      value: 3,
    })
    expect(parseWhen('flag == false')).toEqual({
      type: 'eq',
      key: 'flag',
      value: false,
    })
  })

  it.each([
    'a &&',
    '&& a',
    '(a || b',
    'a b',
    "a == 'open",
    'a == b',
    "!a == 'x'",
    'a # b',
  ])('rejects %j', (expr) => {
    expect(() => parseWhen(expr)).toThrow()
  })
})

describe('evaluateWhen', () => {
  beforeEach(() => {
    resetContextKeys()
    vi.clearAllMocks()
  })

  it('treats an empty or missing expression as always true', () => {
    expect(evaluateWhen(undefined)).toBe(true)
    expect(evaluateWhen('')).toBe(true)
    expect(evaluateWhen('   ')).toBe(true)
  })

  it('uses the truthiness of a key; unknown keys are falsy', () => {
    expect(evaluateWhen('editorFocus')).toBe(false)
    setContextKey('editorFocus', true)
    expect(evaluateWhen('editorFocus')).toBe(true)
    setContextKey('editorFocus', 0)
    expect(evaluateWhen('editorFocus')).toBe(false)
    expect(evaluateWhen('!neverSet')).toBe(true)
  })

  it('applies precedence: !a && b || c', () => {
    setContextKey('c', true)
    // (!a && b) || c — true through c even though b is unset.
    expect(evaluateWhen('!a && b || c')).toBe(true)
    setContextKey('c', false)
    expect(evaluateWhen('!a && b || c')).toBe(false)
    setContextKey('b', true)
    expect(evaluateWhen('!a && b || c')).toBe(true)
  })

  it('lets parentheses override precedence', () => {
    setContextKey('a', true)
    // a || b && c  →  a || (b && c)  →  true
    expect(evaluateWhen('a || b && c')).toBe(true)
    // (a || b) && c  →  false, c is unset
    expect(evaluateWhen('(a || b) && c')).toBe(false)
    expect(evaluateWhen('!(a && c)')).toBe(true)
  })

  it('compares a key to string, number, and boolean literals', () => {
    setContextKey('view', 'pdf')
    setContextKey('count', 2)
    setContextKey('pro', true)
    expect(evaluateWhen("view == 'pdf'")).toBe(true)
    expect(evaluateWhen("view != 'pdf'")).toBe(false)
    expect(evaluateWhen("view == 'canvas'")).toBe(false)
    expect(evaluateWhen('count == 2')).toBe(true)
    expect(evaluateWhen('count != 2')).toBe(false)
    expect(evaluateWhen('pro == true')).toBe(true)
    expect(evaluateWhen("missing == 'x'")).toBe(false)
    expect(evaluateWhen("missing != 'x'")).toBe(true)
  })

  it('accepts true/false constants', () => {
    expect(evaluateWhen('true')).toBe(true)
    expect(evaluateWhen('false || !true')).toBe(false)
  })

  it('is false for a malformed expression and warns only once', () => {
    setContextKey('a', true)
    expect(evaluateWhen('a &&& b')).toBe(false)
    expect(evaluateWhen('a &&& b')).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('a &&& b'))
  })
})

describe('whenSpecificity', () => {
  it('counts terms, with none for an empty expression', () => {
    expect(whenSpecificity(undefined)).toBe(0)
    expect(whenSpecificity('')).toBe(0)
    expect(whenSpecificity('editorFocus')).toBe(1)
    expect(whenSpecificity("editorFocus && view == 'pdf'")).toBe(2)
    expect(whenSpecificity('!(a || b) && c')).toBe(3)
  })
})
