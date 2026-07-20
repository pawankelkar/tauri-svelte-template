import { describe, it, expect, vi } from 'vitest'
import {
  normalizeShortcut,
  parseShortcut,
  buildCombo,
  toTauriAccelerator,
  fromTauriAccelerator,
  isValidGlobalShortcutCombo,
  createKeydownHandler,
} from './shortcuts'

describe('normalizeShortcut', () => {
  it('lowercases and sorts modifiers', () => {
    expect(normalizeShortcut('Shift+Cmd+K')).toBe('mod+shift+k')
  })

  it('unifies Ctrl/Command/Meta to mod', () => {
    expect(normalizeShortcut('Ctrl+K')).toBe('mod+k')
    expect(normalizeShortcut('Command+K')).toBe('mod+k')
    expect(normalizeShortcut('Meta+K')).toBe('mod+k')
  })

  it('unifies Option to alt', () => {
    expect(normalizeShortcut('Option+K')).toBe('alt+k')
    expect(normalizeShortcut('Opt+K')).toBe('alt+k')
  })

  it('deduplicates modifiers', () => {
    expect(normalizeShortcut('Ctrl+Cmd+K')).toBe('mod+k')
  })

  it('handles single key with no modifiers', () => {
    expect(normalizeShortcut('k')).toBe('k')
  })

  it('preserves multi-char key names', () => {
    expect(normalizeShortcut('Ctrl+Enter')).toBe('mod+enter')
  })
})

describe('parseShortcut', () => {
  it('splits modifiers and key', () => {
    expect(parseShortcut('mod+shift+k')).toEqual({
      key: 'k',
      modifiers: ['mod', 'shift'],
    })
  })

  it('handles key-only', () => {
    expect(parseShortcut('k')).toEqual({ key: 'k', modifiers: [] })
  })

  it('round-trips through normalize', () => {
    const normalized = normalizeShortcut('Shift+Cmd+K')
    const parsed = parseShortcut(normalized)
    expect(parsed).toEqual({ key: 'k', modifiers: ['mod', 'shift'] })
  })
})

describe('buildCombo', () => {
  function makeEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
    return {
      key: 'k',
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      ...overrides,
    } as KeyboardEvent
  }

  it('builds mod+k from ctrlKey', () => {
    expect(buildCombo(makeEvent({ ctrlKey: true }))).toBe('mod+k')
  })

  it('builds mod+k from metaKey', () => {
    expect(buildCombo(makeEvent({ metaKey: true }))).toBe('mod+k')
  })

  it('builds mod+shift+k', () => {
    expect(buildCombo(makeEvent({ ctrlKey: true, shiftKey: true }))).toBe(
      'mod+shift+k',
    )
  })

  it('returns only modifiers for modifier-only key events', () => {
    expect(buildCombo(makeEvent({ key: 'Control', ctrlKey: true }))).toBe('mod')
  })

  it('returns plain key with no modifiers', () => {
    expect(buildCombo(makeEvent({}))).toBe('k')
  })
})

describe('toTauriAccelerator', () => {
  it('converts mod+k', () => {
    expect(toTauriAccelerator('mod+k')).toBe('CmdOrCtrl+K')
  })

  it('converts mod+shift+b', () => {
    expect(toTauriAccelerator('mod+shift+b')).toBe('CmdOrCtrl+Shift+B')
  })

  it('converts alt+enter', () => {
    expect(toTauriAccelerator('alt+enter')).toBe('Alt+enter')
  })
})

describe('createKeydownHandler', () => {
  it('dispatches matching combo', () => {
    const dispatch = vi.fn()
    const handler = createKeydownHandler(
      [],
      (combo) => (combo === 'mod+k' ? 'open-palette' : undefined),
      dispatch,
    )

    const event = {
      key: 'k',
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      target: document.createElement('div'),
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent

    handler(event)
    expect(dispatch).toHaveBeenCalledWith('open-palette')
    expect(event.preventDefault).toHaveBeenCalled()
  })

  it('does not dispatch when no match', () => {
    const dispatch = vi.fn()
    const handler = createKeydownHandler([], () => undefined, dispatch)

    handler({
      key: 'j',
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      target: document.createElement('div'),
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent)

    expect(dispatch).not.toHaveBeenCalled()
  })

  it('suppresses non-allowlisted combos in editable targets', () => {
    const dispatch = vi.fn()
    const handler = createKeydownHandler(
      ['mod+k'],
      (combo) => (combo === 'mod+b' ? 'toggle-sidebar' : undefined),
      dispatch,
    )

    const input = document.createElement('input')
    handler({
      key: 'b',
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      target: input,
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent)

    expect(dispatch).not.toHaveBeenCalled()
  })

  it('allows allowlisted combos in editable targets', () => {
    const dispatch = vi.fn()
    const handler = createKeydownHandler(
      ['mod+k'],
      (combo) => (combo === 'mod+k' ? 'open-palette' : undefined),
      dispatch,
    )

    const input = document.createElement('input')
    handler({
      key: 'k',
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      target: input,
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent)

    expect(dispatch).toHaveBeenCalledWith('open-palette')
  })
})

describe('fromTauriAccelerator', () => {
  it('round-trips with toTauriAccelerator', () => {
    for (const combo of [
      'mod+k',
      'mod+shift+k',
      'mod+alt+p',
      'mod+shift+alt+f',
    ]) {
      const { key, modifiers } = fromTauriAccelerator(toTauriAccelerator(combo))
      expect([...modifiers, key].join('+')).toBe(combo)
    }
  })

  it('accepts the modifier spellings Tauri emits', () => {
    expect(fromTauriAccelerator('CommandOrControl+Shift+.')).toEqual({
      key: '.',
      modifiers: ['mod', 'shift'],
    })
    expect(fromTauriAccelerator('Ctrl+Alt+Delete')).toEqual({
      key: 'delete',
      modifiers: ['mod', 'alt'],
    })
  })

  it('sorts modifiers into canonical order regardless of input order', () => {
    expect(fromTauriAccelerator('Alt+Shift+CmdOrCtrl+J').modifiers).toEqual([
      'mod',
      'shift',
      'alt',
    ])
  })

  it('collapses duplicate modifiers that map to the same key', () => {
    expect(fromTauriAccelerator('Ctrl+Cmd+K').modifiers).toEqual(['mod'])
  })
})

describe('isValidGlobalShortcutCombo', () => {
  it('accepts a key with at least one modifier', () => {
    expect(isValidGlobalShortcutCombo('mod+k')).toBe(true)
    expect(isValidGlobalShortcutCombo('mod+shift+k')).toBe(true)
  })

  it('rejects modifier-only combos', () => {
    expect(isValidGlobalShortcutCombo('mod')).toBe(false)
    expect(isValidGlobalShortcutCombo('mod+shift')).toBe(false)
  })

  it('rejects a bare key, which would swallow it system-wide', () => {
    expect(isValidGlobalShortcutCombo('k')).toBe(false)
  })

  it('rejects an empty combo', () => {
    expect(isValidGlobalShortcutCombo('')).toBe(false)
  })
})
