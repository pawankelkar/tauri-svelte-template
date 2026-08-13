import { describe, it, expect } from 'vitest'
import { isSuppressedBrowserKey } from './browser-keys'

function key(init: KeyboardEventInit & { key: string }): KeyboardEvent {
  return new KeyboardEvent('keydown', init)
}

describe('isSuppressedBrowserKey', () => {
  it('suppresses Ctrl+F on Windows and Linux', () => {
    const event = key({ key: 'f', ctrlKey: true })
    expect(isSuppressedBrowserKey(event, 'windows')).toBe(true)
    expect(isSuppressedBrowserKey(event, 'linux')).toBe(true)
  })

  it('suppresses Cmd+F on macOS', () => {
    expect(
      isSuppressedBrowserKey(key({ key: 'f', metaKey: true }), 'macos'),
    ).toBe(true)
  })

  it('leaves Ctrl+F alone on macOS, where text fields use it to move the caret', () => {
    expect(
      isSuppressedBrowserKey(key({ key: 'f', ctrlKey: true }), 'macos'),
    ).toBe(false)
  })

  it('leaves Cmd+F alone off macOS', () => {
    expect(
      isSuppressedBrowserKey(key({ key: 'f', metaKey: true }), 'windows'),
    ).toBe(false)
  })

  it('suppresses print and find-next', () => {
    expect(
      isSuppressedBrowserKey(key({ key: 'p', ctrlKey: true }), 'windows'),
    ).toBe(true)
    expect(
      isSuppressedBrowserKey(key({ key: 'g', ctrlKey: true }), 'windows'),
    ).toBe(true)
    expect(isSuppressedBrowserKey(key({ key: 'F3' }), 'windows')).toBe(true)
  })

  it('suppresses find-previous, which adds Shift', () => {
    expect(
      isSuppressedBrowserKey(
        key({ key: 'g', ctrlKey: true, shiftKey: true }),
        'windows',
      ),
    ).toBe(true)
  })

  it('ignores an unmodified letter', () => {
    expect(isSuppressedBrowserKey(key({ key: 'f' }), 'windows')).toBe(false)
  })

  it('ignores keys the webview does not claim', () => {
    expect(
      isSuppressedBrowserKey(key({ key: 'k', ctrlKey: true }), 'windows'),
    ).toBe(false)
  })

  it('ignores combos that add Alt, which the webview does not claim either', () => {
    expect(
      isSuppressedBrowserKey(
        key({ key: 'f', ctrlKey: true, altKey: true }),
        'windows',
      ),
    ).toBe(false)
  })

  it('is case-insensitive, since Shift uppercases event.key', () => {
    expect(
      isSuppressedBrowserKey(
        key({ key: 'F', ctrlKey: true, shiftKey: true }),
        'windows',
      ),
    ).toBe(true)
  })
})

describe('isSuppressedBrowserKey, reload', () => {
  const on = { reload: true }

  it('leaves reload alone unless asked, so dev keeps a manual refresh', () => {
    expect(
      isSuppressedBrowserKey(key({ key: 'r', ctrlKey: true }), 'windows'),
    ).toBe(false)
    expect(isSuppressedBrowserKey(key({ key: 'F5' }), 'windows')).toBe(false)
  })

  it('suppresses Ctrl+R and F5 when asked', () => {
    expect(
      isSuppressedBrowserKey(key({ key: 'r', ctrlKey: true }), 'windows', on),
    ).toBe(true)
    expect(isSuppressedBrowserKey(key({ key: 'F5' }), 'windows', on)).toBe(true)
  })

  it('suppresses Cmd+R on macOS, and not bare Ctrl+R', () => {
    expect(
      isSuppressedBrowserKey(key({ key: 'r', metaKey: true }), 'macos', on),
    ).toBe(true)
    expect(
      isSuppressedBrowserKey(key({ key: 'r', ctrlKey: true }), 'macos', on),
    ).toBe(false)
  })

  it('covers the hard-reload variants', () => {
    expect(
      isSuppressedBrowserKey(
        key({ key: 'R', ctrlKey: true, shiftKey: true }),
        'windows',
        on,
      ),
    ).toBe(true)
    expect(
      isSuppressedBrowserKey(key({ key: 'F5', ctrlKey: true }), 'windows', on),
    ).toBe(true)
    expect(
      isSuppressedBrowserKey(key({ key: 'F5', shiftKey: true }), 'windows', on),
    ).toBe(true)
  })

  it('still suppresses the find bar when reload is left enabled', () => {
    expect(
      isSuppressedBrowserKey(key({ key: 'f', ctrlKey: true }), 'windows', {
        reload: false,
      }),
    ).toBe(true)
  })
})
