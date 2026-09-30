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
  resolveShortcut,
  getEffectiveShortcut,
  setShortcutOverrideResolver,
  executeCommand,
  __resetCommandsForTests,
  type AppCommand,
} from './registry.svelte'
import { setContextKey, resetContextKeys } from './context-keys.svelte'
import { __resetPlatformCache } from '$lib/hooks/use-platform.svelte'

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
    resetContextKeys()
    vi.clearAllMocks()
  })

  it('registers and retrieves a command, defaulting its source to core', () => {
    const cmd = makeCommand({ id: 'my-cmd' })
    registerCommand(cmd)
    expect(getCommand('my-cmd')).toStrictEqual({ ...cmd, source: 'core' })
  })

  it('keeps an explicit source', () => {
    registerCommand(makeCommand({ id: 'p', source: 'plugin' }))
    expect(getCommand('p')?.source).toBe('plugin')
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

  it('executeCommand passes the default args, or the caller override', async () => {
    const run = vi.fn()
    registerCommand(makeCommand({ id: 'exec', run, args: { n: 1 } }))
    await executeCommand('exec')
    expect(run).toHaveBeenLastCalledWith({ n: 1 })
    await executeCommand('exec', { n: 2 })
    expect(run).toHaveBeenLastCalledWith({ n: 2 })
  })

  it('executeCommand skips a disabled command', async () => {
    const run = vi.fn()
    registerCommand(makeCommand({ id: 'off', run, isEnabled: () => false }))
    await executeCommand('off')
    expect(run).not.toHaveBeenCalled()
  })

  it('executeCommand warns on unknown id', async () => {
    const { warn } = await import('$lib/logger')
    await executeCommand('nonexistent')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('nonexistent'))
  })

  it('resolveShortcut resolves registered shortcut', () => {
    registerCommand(makeCommand({ id: 'with-shortcut', shortcut: 'mod+k' }))
    expect(resolveShortcut('mod+k')?.id).toBe('with-shortcut')
  })

  it('resolveShortcut returns undefined for no match', () => {
    expect(resolveShortcut('mod+z')).toBeUndefined()
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
    expect(resolveShortcut('mod+p')?.id).toBe('test-cmd')
    expect(resolveShortcut('mod+k')).toBeUndefined()
  })

  it('a null override unbinds the shortcut', () => {
    setShortcutOverrideResolver(() => null)
    const cmd = makeCommand({ shortcut: 'mod+k' })
    expect(getEffectiveShortcut(cmd)).toBeUndefined()

    registerCommand(cmd)
    expect(resolveShortcut('mod+k')).toBeUndefined()
  })
})

describe('resolveShortcut', () => {
  beforeEach(() => {
    __resetCommandsForTests()
    resetContextKeys()
    __resetPlatformCache()
  })

  it('skips a command whose when does not hold', () => {
    registerCommand(
      makeCommand({ id: 'scoped', shortcut: 'mod+e', when: 'editorFocus' }),
    )
    expect(resolveShortcut('mod+e')).toBeUndefined()
    setContextKey('editorFocus', true)
    expect(resolveShortcut('mod+e')?.id).toBe('scoped')
  })

  it('skips disabled commands in favour of the next candidate', () => {
    registerCommands([
      makeCommand({ id: 'off', shortcut: 'mod+e', isEnabled: () => false }),
      makeCommand({ id: 'on', shortcut: 'mod+e' }),
    ])
    expect(resolveShortcut('mod+e')?.id).toBe('on')
  })

  it('skips commands hidden on this platform', () => {
    // Outside Tauri the platform lookup falls back to macOS.
    registerCommands([
      makeCommand({ id: 'win', shortcut: 'mod+e', platforms: ['windows'] }),
      makeCommand({ id: 'mac', shortcut: 'mod+e', platforms: ['macos'] }),
    ])
    expect(resolveShortcut('mod+e')?.id).toBe('mac')
  })

  it('prefers a scoped command over an unscoped one when its when holds', () => {
    registerCommands([
      makeCommand({ id: 'global', shortcut: 'mod+e' }),
      makeCommand({ id: 'editor', shortcut: 'mod+e', when: 'editorFocus' }),
    ])
    expect(resolveShortcut('mod+e')?.id).toBe('global')
    setContextKey('editorFocus', true)
    expect(resolveShortcut('mod+e')?.id).toBe('editor')
  })

  it('prefers the more specific when', () => {
    setContextKey('editorFocus', true)
    setContextKey('recording', true)
    registerCommands([
      makeCommand({ id: 'one', shortcut: 'mod+e', when: 'editorFocus' }),
      makeCommand({
        id: 'two',
        shortcut: 'mod+e',
        when: 'editorFocus && recording',
      }),
    ])
    expect(resolveShortcut('mod+e')?.id).toBe('two')
  })

  it('prefers plugin over core at equal specificity', () => {
    registerCommands([
      makeCommand({ id: 'core', shortcut: 'mod+e' }),
      makeCommand({ id: 'plugin', shortcut: 'mod+e', source: 'plugin' }),
    ])
    expect(resolveShortcut('mod+e')?.id).toBe('plugin')
  })

  it('a user override beats specificity and source', () => {
    setContextKey('editorFocus', true)
    registerCommands([
      makeCommand({
        id: 'plugin',
        shortcut: 'mod+e',
        when: 'editorFocus',
        source: 'plugin',
      }),
      makeCommand({ id: 'rebound', shortcut: 'mod+1' }),
    ])
    setShortcutOverrideResolver((id) =>
      id === 'rebound' ? 'mod+e' : undefined,
    )
    expect(resolveShortcut('mod+e')?.id).toBe('rebound')
  })

  it('falls back to registration order on a full tie', () => {
    registerCommands([
      makeCommand({ id: 'first', shortcut: 'mod+e' }),
      makeCommand({ id: 'second', shortcut: 'mod+e' }),
    ])
    expect(resolveShortcut('mod+e')?.id).toBe('first')
  })
})
