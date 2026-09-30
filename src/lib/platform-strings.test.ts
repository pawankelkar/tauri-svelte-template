import { describe, it, expect } from 'vitest'
import { getPlatformStrings, formatShortcut } from './platform-strings'

describe('getPlatformStrings', () => {
  it('returns macOS strings', () => {
    const s = getPlatformStrings('macos')
    expect(s.fileManagerName).toBe('Finder')
    expect(s.modifierSymbol).toBe('⌘')
    expect(s.optionSymbol).toBe('⌥')
    expect(s.quitLabel).toBe('Quit')
    expect(s.trashName).toBe('Trash')
  })

  it('returns Windows strings', () => {
    const s = getPlatformStrings('windows')
    expect(s.fileManagerName).toBe('Explorer')
    expect(s.modifierSymbol).toBe('Ctrl')
    expect(s.quitLabel).toBe('Exit')
    expect(s.trashName).toBe('Recycle Bin')
  })

  it('returns Linux strings', () => {
    const s = getPlatformStrings('linux')
    expect(s.fileManagerName).toBe('Files')
    expect(s.modifierSymbol).toBe('Ctrl')
    expect(s.quitLabel).toBe('Quit')
    expect(s.trashName).toBe('Trash')
  })
})

describe('formatShortcut', () => {
  it('formats macOS single modifier', () => {
    expect(formatShortcut('macos', 'k', ['mod'])).toBe('⌘K')
  })

  it('formats macOS multiple modifiers in correct order', () => {
    expect(formatShortcut('macos', 'k', ['mod', 'shift'])).toBe('⇧⌘K')
  })

  it('formats macOS with alt', () => {
    expect(formatShortcut('macos', 'k', ['alt', 'mod'])).toBe('⌥⌘K')
  })

  it('formats macOS all modifiers', () => {
    expect(formatShortcut('macos', 'k', ['mod', 'shift', 'alt'])).toBe('⌥⇧⌘K')
  })

  it('formats Windows single modifier', () => {
    expect(formatShortcut('windows', 'k', ['mod'])).toBe('Ctrl+K')
  })

  it('formats Windows multiple modifiers', () => {
    expect(formatShortcut('windows', 'k', ['mod', 'shift'])).toBe(
      'Ctrl+Shift+K',
    )
  })

  it('formats Linux same as Windows', () => {
    expect(formatShortcut('linux', 'b', ['mod'])).toBe('Ctrl+B')
  })

  it('handles multi-char keys', () => {
    expect(formatShortcut('macos', 'enter', ['mod'])).toBe('⌘Enter')
    expect(formatShortcut('windows', 'enter', ['mod'])).toBe('Ctrl+Enter')
  })

  it('renders arrow keys as glyphs on macOS', () => {
    expect(formatShortcut('macos', 'arrowright', ['mod', 'alt'])).toBe('⌥⌘→')
    expect(formatShortcut('macos', 'arrowleft', ['mod', 'alt'])).toBe('⌥⌘←')
    expect(formatShortcut('macos', 'arrowup', ['mod'])).toBe('⌘↑')
    expect(formatShortcut('macos', 'arrowdown', ['mod'])).toBe('⌘↓')
  })

  it('renders arrow keys as readable names elsewhere', () => {
    expect(formatShortcut('windows', 'arrowright', ['mod', 'alt'])).toBe(
      'Ctrl+Alt+Right',
    )
    expect(formatShortcut('linux', 'arrowleft', ['mod', 'alt'])).toBe(
      'Ctrl+Alt+Left',
    )
    expect(formatShortcut('windows', 'arrowup', ['mod'])).toBe('Ctrl+Up')
    expect(formatShortcut('linux', 'arrowdown', ['mod'])).toBe('Ctrl+Down')
  })

  it('accepts accelerator-cased key names', () => {
    expect(formatShortcut('macos', 'ArrowRight', ['mod'])).toBe('⌘→')
    expect(formatShortcut('windows', 'PageDown', ['mod'])).toBe('Ctrl+PageDown')
  })
})
