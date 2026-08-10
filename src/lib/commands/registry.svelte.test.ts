import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('$lib/logger', () => ({
  warn: vi.fn(),
  logger: { warn: vi.fn() },
}))

import {
  registerCommand,
  registerCommands,
  unregisterCommand,
  getCommand,
  listCommands,
  findCommandIdForShortcut,
  getEffectiveShortcut,
  setShortcutOverrideResolver,
  executeCommand,
  __resetCommandsForTests,
  type AppCommand,
} from './registry.svelte'

function makeCommand(overrides: Partial<AppCommand> = {}): AppCommand {
  return {
    id: 'test-cmd',
    labelKey: 'test.label',
    category: 'test',
    run: vi.fn(),
    ...overrides,
  }
}

describe('command registry', () => {
  beforeEach(() => {
    __resetCommandsForTests()
    vi.clearAllMocks()
  })

  it('registers and retrieves a command', () => {
    const cmd = makeCommand({ id: 'my-cmd' })
    registerCommand(cmd)
    expect(getCommand('my-cmd')).toStrictEqual(cmd)
  })

  it('lists all registered commands', () => {
    registerCommands([makeCommand({ id: 'a' }), makeCommand({ id: 'b' })])
    expect(listCommands()).toHaveLength(2)
  })

  it('skips duplicate registration', async () => {
    const { warn } = await import('$lib/logger')
    registerCommand(makeCommand({ id: 'dup' }))
    registerCommand(makeCommand({ id: 'dup' }))
    expect(listCommands()).toHaveLength(1)
    expect(warn).toHaveBeenCalled()
  })

  it('unregisters a command', () => {
    registerCommand(makeCommand({ id: 'rm-me' }))
    unregisterCommand('rm-me')
    expect(getCommand('rm-me')).toBeUndefined()
  })

  it('executeCommand invokes run()', async () => {
    const run = vi.fn()
    registerCommand(makeCommand({ id: 'exec', run }))
    await executeCommand('exec')
    expect(run).toHaveBeenCalledOnce()
  })

  it('executeCommand warns on unknown id', async () => {
    const { warn } = await import('$lib/logger')
    await executeCommand('nonexistent')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('nonexistent'))
  })

  it('findCommandIdForShortcut resolves registered shortcut', () => {
    registerCommand(makeCommand({ id: 'with-shortcut', shortcut: 'mod+k' }))
    expect(findCommandIdForShortcut('mod+k')).toBe('with-shortcut')
  })

  it('findCommandIdForShortcut returns undefined for no match', () => {
    expect(findCommandIdForShortcut('mod+z')).toBeUndefined()
  })

  it('getEffectiveShortcut returns the default without an override', () => {
    const cmd = makeCommand({ shortcut: 'mod+k' })
    expect(getEffectiveShortcut(cmd)).toBe('mod+k')
  })

  it('a string override replaces the default shortcut', () => {
    setShortcutOverrideResolver((id) =>
      id === 'test-cmd' ? 'mod+p' : undefined,
    )
    const cmd = makeCommand({ shortcut: 'mod+k' })
    expect(getEffectiveShortcut(cmd)).toBe('mod+p')

    registerCommand(cmd)
    expect(findCommandIdForShortcut('mod+p')).toBe('test-cmd')
    expect(findCommandIdForShortcut('mod+k')).toBeUndefined()
  })

  it('a null override unbinds the shortcut', () => {
    setShortcutOverrideResolver(() => null)
    const cmd = makeCommand({ shortcut: 'mod+k' })
    expect(getEffectiveShortcut(cmd)).toBeUndefined()

    registerCommand(cmd)
    expect(findCommandIdForShortcut('mod+k')).toBeUndefined()
  })
})
