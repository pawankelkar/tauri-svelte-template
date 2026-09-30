import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockIPC } from '@tauri-apps/api/mocks'

vi.mock('$lib/logger', () => ({
  warn: vi.fn(),
  logger: { warn: vi.fn(), error: vi.fn() },
}))
// The real menu module drags in @tauri-apps/api/menu; the only contract used
// here is "a rebind triggers a rebuild".
vi.mock('$lib/menu', () => ({ rebuildMenu: vi.fn(() => Promise.resolve()) }))

import { rebuildMenu } from '$lib/menu'
import {
  initCommandShortcutOverrides,
  isShortcutCustomized,
  findShortcutConflict,
  isBlockingConflict,
  isReservedShortcut,
  setCommandShortcut,
  resetCommandShortcut,
} from './command-shortcuts'
import {
  registerCommands,
  getCommand,
  getEffectiveShortcut,
  __resetCommandsForTests,
  type AppCommand,
} from './registry.svelte'
import {
  initPreferences,
  getPreferences,
  __resetPreferencesForTests,
} from '$lib/stores/preferences.svelte'
import { defaultPreferences } from '$lib/stores/preferences-schema'

function makeCommand(overrides: Partial<AppCommand> = {}): AppCommand {
  return {
    id: 'test-cmd',
    labelKey: 'test.label',
    category: 'test',
    run: vi.fn(),
    ...overrides,
  }
}

async function setup(
  prefs: Partial<ReturnType<typeof defaultPreferences>> = {},
  extra: AppCommand[] = [],
) {
  mockIPC((cmd) => {
    if (cmd === 'load_preferences') return { ...defaultPreferences(), ...prefs }
    return null
  })
  await initPreferences()
  registerCommands([
    makeCommand({ id: 'alpha', shortcut: 'mod+1' }),
    makeCommand({ id: 'beta', shortcut: 'mod+2' }),
    makeCommand({ id: 'gamma' }),
    ...extra,
  ])
  initCommandShortcutOverrides()
}

describe('command shortcut overrides', () => {
  beforeEach(() => {
    __resetPreferencesForTests()
    __resetCommandsForTests()
    vi.clearAllMocks()
  })

  it('a persisted override wins over the default', async () => {
    await setup({ commandShortcuts: { alpha: 'mod+9' } })
    expect(getEffectiveShortcut(getCommand('alpha')!)).toBe('mod+9')
    expect(isShortcutCustomized('alpha')).toBe(true)
    expect(isShortcutCustomized('beta')).toBe(false)
  })

  it('setCommandShortcut stores the new combo', async () => {
    await setup()
    setCommandShortcut('alpha', 'mod+9')
    expect(getPreferences().commandShortcuts).toEqual({ alpha: 'mod+9' })
    expect(getEffectiveShortcut(getCommand('alpha')!)).toBe('mod+9')
    expect(rebuildMenu).toHaveBeenCalled()
  })

  it('setting the default combo removes the override instead', async () => {
    await setup({ commandShortcuts: { alpha: 'mod+9' } })
    setCommandShortcut('alpha', 'mod+1')
    expect(getPreferences().commandShortcuts).toEqual({})
    expect(isShortcutCustomized('alpha')).toBe(false)
  })

  it('null unbinds; resetCommandShortcut restores the default', async () => {
    await setup()
    setCommandShortcut('alpha', null)
    expect(getEffectiveShortcut(getCommand('alpha')!)).toBeUndefined()
    resetCommandShortcut('alpha')
    expect(getEffectiveShortcut(getCommand('alpha')!)).toBe('mod+1')
    expect(getPreferences().commandShortcuts).toEqual({})
  })

  it('unbinding a command with no default stays a no-op override-wise', async () => {
    await setup()
    setCommandShortcut('gamma', null)
    expect(getPreferences().commandShortcuts).toEqual({})
  })

  it('findShortcutConflict sees other commands (post-override) but not itself', async () => {
    await setup({ commandShortcuts: { beta: 'mod+9' } })
    expect(findShortcutConflict('mod+1', 'alpha')).toBeNull()
    expect(findShortcutConflict('mod+9', 'alpha')).toEqual({
      kind: 'conflict',
      commandId: 'beta',
    })
    // beta's default no longer counts — the override replaced it.
    expect(findShortcutConflict('mod+2', 'alpha')).toBeNull()
  })

  it('findShortcutConflict sees the OS-level global shortcuts', async () => {
    await setup({ globalShortcut: 'CmdOrCtrl+Shift+F' })
    expect(findShortcutConflict('mod+shift+f', 'alpha')).toEqual({
      kind: 'reserved',
      reason: 'global',
      purpose: 'focusMain',
    })
    expect(findShortcutConflict('mod+shift+.', 'alpha')).toEqual({
      kind: 'reserved',
      reason: 'global',
      purpose: 'quickPane',
    })
  })
})

describe('when-aware conflict classification', () => {
  beforeEach(() => {
    __resetPreferencesForTests()
    __resetCommandsForTests()
  })

  it('an unscoped command clashes with anything on the same combo', async () => {
    await setup({}, [
      makeCommand({ id: 'scoped', shortcut: 'mod+e', when: 'editorFocus' }),
    ])
    // Rebinding an unscoped command onto a scoped one's combo…
    expect(findShortcutConflict('mod+e', 'alpha')).toEqual({
      kind: 'conflict',
      commandId: 'scoped',
    })
    // …and a scoped command onto an unscoped one's.
    expect(findShortcutConflict('mod+1', 'scoped')).toEqual({
      kind: 'conflict',
      commandId: 'alpha',
    })
  })

  it('identical when expressions conflict', async () => {
    await setup({}, [
      makeCommand({ id: 'a', shortcut: 'mod+e', when: 'editorFocus' }),
      makeCommand({ id: 'b', when: 'editorFocus' }),
    ])
    expect(findShortcutConflict('mod+e', 'b')).toEqual({
      kind: 'conflict',
      commandId: 'a',
    })
  })

  it('different non-empty when expressions only warn', async () => {
    await setup({}, [
      makeCommand({ id: 'a', shortcut: 'mod+e', when: 'editorFocus' }),
      makeCommand({ id: 'b', when: 'canvasFocus' }),
    ])
    const result = findShortcutConflict('mod+e', 'b')
    expect(result).toEqual({ kind: 'warning', commandId: 'a' })
    expect(isBlockingConflict(result!)).toBe(false)
  })

  it('a blocking conflict wins over a warning on the same combo', async () => {
    await setup({}, [
      makeCommand({ id: 'a', shortcut: 'mod+e', when: 'canvasFocus' }),
      makeCommand({ id: 'b', shortcut: 'mod+e', when: 'editorFocus' }),
      makeCommand({ id: 'c', when: 'editorFocus' }),
    ])
    expect(findShortcutConflict('mod+e', 'c')).toEqual({
      kind: 'conflict',
      commandId: 'b',
    })
  })

  it('ignores commands hidden on this platform', async () => {
    await setup({}, [
      makeCommand({ id: 'win', shortcut: 'mod+e', platforms: ['windows'] }),
    ])
    expect(findShortcutConflict('mod+e', 'alpha')).toBeNull()
  })

  it('OS-reserved combos are refused', async () => {
    await setup()
    for (const combo of [
      'mod+q',
      'mod+h',
      'mod+m',
      'mod+tab',
      'mod+space',
      'alt+f4',
    ]) {
      expect(isReservedShortcut(combo)).toBe(true)
      const result = findShortcutConflict(combo, 'alpha')
      expect(result).toEqual({ kind: 'reserved', reason: 'os' })
      expect(isBlockingConflict(result!)).toBe(true)
    }
    expect(isReservedShortcut('mod+shift+q')).toBe(false)
  })

  it('mod+w is not reserved, so tab.close can be moved and bound back', async () => {
    await setup()
    expect(isReservedShortcut('mod+w')).toBe(false)
    expect(findShortcutConflict('mod+w', 'alpha')).toBeNull()
  })

  it("a command's own default is allowed even when it is on the reserved list", async () => {
    await setup({ commandShortcuts: { quitter: 'mod+shift+x' } }, [
      makeCommand({ id: 'quitter', shortcut: 'mod+q' }),
    ])
    expect(findShortcutConflict('mod+q', 'quitter')).toBeNull()
    // …but not for any other command.
    expect(findShortcutConflict('mod+q', 'alpha')).toEqual({
      kind: 'reserved',
      reason: 'os',
    })
  })
})
