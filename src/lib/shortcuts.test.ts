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
import { formatShortcut } from './platform-strings'

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

  it('builds mod+\\ from the backslash key', () => {
    expect(buildCombo(makeEvent({ key: '\\', metaKey: true }))).toBe('mod+\\')
  })

  it('reads the physical key when macOS Option composes a character', () => {
    // ⌥⌘\ reports « and ⌥⌘P reports π on a US layout.
    expect(
      buildCombo(
        makeEvent({ key: '«', code: 'Backslash', metaKey: true, altKey: true }),
      ),
    ).toBe('mod+alt+\\')
    expect(
      buildCombo(
        makeEvent({ key: 'π', code: 'KeyP', metaKey: true, altKey: true }),
      ),
    ).toBe('mod+alt+p')
    expect(
      buildCombo(makeEvent({ key: 'Dead', code: 'KeyE', altKey: true })),
    ).toBe('alt+e')
  })

  it('keeps an ASCII character AltGr produced', () => {
    // German layout: AltGr+ß types \ and reports Ctrl+Alt.
    expect(
      buildCombo(
        makeEvent({ key: '\\', code: 'Minus', ctrlKey: true, altKey: true }),
      ),
    ).toBe('mod+alt+\\')
  })

  it('spells out the space bar', () => {
    expect(buildCombo(makeEvent({ key: ' ', metaKey: true }))).toBe('mod+space')
    expect(
      buildCombo(makeEvent({ key: ' ', code: 'Space', altKey: true })),
    ).toBe('alt+space')
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
  function keydown(
    key: string,
    target: EventTarget,
    extra: Partial<KeyboardEvent> = {},
  ): KeyboardEvent {
    return {
      key,
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      target,
      preventDefault: vi.fn(),
      ...extra,
    } as unknown as KeyboardEvent
  }

  it('dispatches matching combo', () => {
    const dispatch = vi.fn()
    const handler = createKeydownHandler(
      (combo) => (combo === 'mod+k' ? { id: 'open-palette' } : undefined),
      dispatch,
    )

    const event = keydown('k', document.createElement('div'))
    handler(event)
    expect(dispatch).toHaveBeenCalledWith('open-palette')
    expect(event.preventDefault).toHaveBeenCalled()
  })

  it('does not dispatch when no match', () => {
    const dispatch = vi.fn()
    const handler = createKeydownHandler(() => undefined, dispatch)

    const event = keydown('j', document.createElement('div'))
    handler(event)

    expect(dispatch).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('suppresses commands without allowInInput in editable targets', () => {
    const dispatch = vi.fn()
    const handler = createKeydownHandler(
      (combo) => (combo === 'mod+b' ? { id: 'toggle-sidebar' } : undefined),
      dispatch,
    )

    const editable = document.createElement('div')
    editable.contentEditable = 'true'
    // jsdom does not implement isContentEditable.
    Object.defineProperty(editable, 'isContentEditable', { value: true })
    for (const target of [
      document.createElement('input'),
      document.createElement('textarea'),
      editable,
    ]) {
      const event = keydown('b', target)
      handler(event)
      // The keystroke is left alone so the field still receives it.
      expect(event.preventDefault).not.toHaveBeenCalled()
    }

    expect(dispatch).not.toHaveBeenCalled()
  })

  it('dispatches allowInInput commands in editable targets', () => {
    const dispatch = vi.fn()
    const handler = createKeydownHandler(
      (combo) =>
        combo === 'mod+shift+p'
          ? { id: 'open-palette', allowInInput: true }
          : undefined,
      dispatch,
    )

    handler(keydown('P', document.createElement('input'), { shiftKey: true }))

    expect(dispatch).toHaveBeenCalledWith('open-palette')
  })

  it('ignores bare keys without a modifier', () => {
    const resolve = vi.fn(() => ({ id: 'x' }))
    const dispatch = vi.fn()
    const handler = createKeydownHandler(resolve, dispatch)

    handler(keydown('k', document.createElement('div'), { ctrlKey: false }))

    expect(resolve).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })
})

describe('backslash bindings', () => {
  it('normalizes and parses a backslash key', () => {
    expect(normalizeShortcut('Cmd+\\')).toBe('mod+\\')
    expect(normalizeShortcut('Alt+Cmd+\\')).toBe('mod+alt+\\')
    expect(parseShortcut('mod+alt+\\')).toEqual({
      key: '\\',
      modifiers: ['mod', 'alt'],
    })
  })

  it('round-trips through the Tauri accelerator form', () => {
    expect(toTauriAccelerator('mod+\\')).toBe('CmdOrCtrl+\\')
    const { key, modifiers } = fromTauriAccelerator(
      toTauriAccelerator('mod+alt+\\'),
    )
    expect([...modifiers, key].join('+')).toBe('mod+alt+\\')
  })

  it('formats for display on every platform', () => {
    expect(formatShortcut('macos', '\\', ['mod'])).toBe('⌘\\')
    expect(formatShortcut('macos', '\\', ['mod', 'alt'])).toBe('⌥⌘\\')
    expect(formatShortcut('windows', '\\', ['mod', 'alt'])).toBe('Ctrl+Alt+\\')
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
