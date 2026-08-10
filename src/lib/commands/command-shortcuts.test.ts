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
      kind: 'command',
      commandId: 'beta',
    })
    // beta's default no longer counts — the override replaced it.
    expect(findShortcutConflict('mod+2', 'alpha')).toBeNull()
  })

  it('findShortcutConflict sees the OS-level global shortcuts', async () => {
    await setup({ globalShortcut: 'CmdOrCtrl+Shift+F' })
    expect(findShortcutConflict('mod+shift+f', 'alpha')).toEqual({
      kind: 'global',
      purpose: 'focusMain',
    })
    expect(findShortcutConflict('mod+shift+.', 'alpha')).toEqual({
      kind: 'global',
      purpose: 'quickPane',
    })
  })
})
