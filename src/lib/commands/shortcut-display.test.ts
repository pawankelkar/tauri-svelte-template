import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('$lib/hooks/use-platform.svelte', () => ({
  getPlatform: vi.fn(() => 'macos'),
}))

import { getPlatform } from '$lib/hooks/use-platform.svelte'
import { formatCombo, formatCommandShortcut } from './shortcut-display'
import {
  registerCommand,
  setShortcutOverrideResolver,
  __resetCommandsForTests,
} from './registry.svelte'

describe('shortcut display', () => {
  beforeEach(() => {
    __resetCommandsForTests()
    vi.mocked(getPlatform).mockReturnValue('macos')
  })

  it('formats a normalised combo for the current platform', () => {
    expect(formatCombo('mod+shift+p')).toBe('⇧⌘P')
    vi.mocked(getPlatform).mockReturnValue('windows')
    expect(formatCombo('mod+shift+p')).toBe('Ctrl+Shift+P')
  })

  it('formats arrow-key bindings readably', () => {
    expect(formatCombo('mod+alt+arrowright')).toBe('⌥⌘→')
    vi.mocked(getPlatform).mockReturnValue('linux')
    expect(formatCombo('mod+alt+arrowright')).toBe('Ctrl+Alt+Right')
  })

  it("follows the command's effective binding", () => {
    registerCommand({
      id: 'palette',
      labelKey: 'x',
      category: 'x',
      shortcut: 'mod+shift+p',
      run: vi.fn(),
    })
    expect(formatCommandShortcut('palette')).toBe('⇧⌘P')

    setShortcutOverrideResolver(() => 'mod+k')
    expect(formatCommandShortcut('palette')).toBe('⌘K')

    // Unbound by the user: nothing to advertise.
    setShortcutOverrideResolver(() => null)
    expect(formatCommandShortcut('palette')).toBeNull()
  })

  it('returns null for an unknown command', () => {
    expect(formatCommandShortcut('nope')).toBeNull()
  })
})
