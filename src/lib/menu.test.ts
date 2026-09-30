import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('$lib/logger', () => ({
  warn: vi.fn(),
  logger: { warn: vi.fn() },
}))
// Only buildMenuSpec() is exercised; nothing is materialised natively.
vi.mock('@tauri-apps/api/menu', () => ({
  Menu: {},
  MenuItem: {},
  PredefinedMenuItem: {},
  Submenu: {},
}))
vi.mock('$lib/commands/app-commands', () => ({
  TOGGLE_THEME: 'toggle-theme',
  OPEN_PREFERENCES: 'open-preferences',
  TOGGLE_LEFT_SIDEBAR: 'toggle-left-sidebar',
  TOGGLE_RIGHT_SIDEBAR: 'toggle-right-sidebar',
  TOGGLE_QUICK_PANE: 'toggle-quick-pane',
  APP_QUIT: 'app-quit',
}))

import { buildMenuSpec, type MenuItemSpec } from './menu'
import {
  registerCommands,
  __resetCommandsForTests,
  type AppCommand,
} from '$lib/commands/registry.svelte'

function makeCommand(overrides: Partial<AppCommand>): AppCommand {
  return {
    id: 'x',
    labelKey: 'test.label',
    category: 'test',
    run: vi.fn(),
    ...overrides,
  }
}

function findItem(id: string): MenuItemSpec | undefined {
  for (const sub of buildMenuSpec('macos')) {
    for (const item of sub.items) {
      if ('commandId' in item && item.commandId === id) return item
    }
  }
  return undefined
}

describe('buildMenuSpec accelerators', () => {
  beforeEach(() => __resetCommandsForTests())

  it('sets a native accelerator for a context-free command', () => {
    registerCommands([
      makeCommand({ id: 'toggle-left-sidebar', shortcut: 'mod+\\' }),
    ])
    expect(findItem('toggle-left-sidebar')?.accelerator).toBe('CmdOrCtrl+\\')
  })

  it('omits the accelerator for a command scoped by when', () => {
    registerCommands([
      makeCommand({
        id: 'toggle-left-sidebar',
        shortcut: 'mod+\\',
        when: 'editorFocus',
      }),
    ])
    const item = findItem('toggle-left-sidebar')
    // The item stays in the menu; only the focus-blind accelerator goes.
    expect(item).toBeDefined()
    expect(item?.accelerator).toBeUndefined()
  })

  it('leaves commands without a shortcut unaccelerated', () => {
    registerCommands([makeCommand({ id: 'toggle-theme' })])
    expect(findItem('toggle-theme')?.accelerator).toBeUndefined()
  })
})
