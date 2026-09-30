import { describe, it, expect, beforeEach } from 'vitest'
import {
  registerTabCommands,
  TAB_CLOSE,
  TAB_CLOSE_OTHERS,
  TAB_NEXT,
  TAB_PREV,
  TAB_REOPEN_CLOSED,
  TAB_TOGGLE_PIN,
} from './tab-commands'
import {
  executeCommand,
  getCommand,
  isCommandEnabled,
  resolveShortcut,
  __resetCommandsForTests,
} from './registry.svelte'
import {
  getActiveTab,
  getGroupTabs,
  initTabs,
  openTab,
  __resetTabsForTests,
} from '$lib/workspace/tabs.svelte'
import { defaultAppState } from '$lib/stores/app-state-schema'

function note(name: string) {
  return { kind: 'note', uri: `ostralith://note/${name}.md`, title: name }
}

function enabled(id: string): boolean {
  return isCommandEnabled(getCommand(id)!)
}

beforeEach(() => {
  __resetCommandsForTests()
  __resetTabsForTests()
  initTabs(defaultAppState())
  registerTabCommands()
})

describe('tab commands', () => {
  it('binds the default shortcuts', () => {
    expect(resolveShortcut('mod+w')).toBeUndefined() // disabled: no tabs
    openTab(note('a'))
    expect(resolveShortcut('mod+w')?.id).toBe(TAB_CLOSE)
    openTab(note('b'))
    expect(resolveShortcut('mod+alt+arrowright')?.id).toBe(TAB_NEXT)
    expect(resolveShortcut('mod+alt+arrowleft')?.id).toBe(TAB_PREV)
  })

  it('are disabled when there is nothing to act on', () => {
    expect(enabled(TAB_CLOSE)).toBe(false)
    expect(enabled(TAB_CLOSE_OTHERS)).toBe(false)
    expect(enabled(TAB_NEXT)).toBe(false)
    expect(enabled(TAB_REOPEN_CLOSED)).toBe(false)
    expect(enabled(TAB_TOGGLE_PIN)).toBe(false)
  })

  it('close, reopen, cycle and pin the active tab', async () => {
    openTab(note('a'))
    openTab(note('b'))
    await executeCommand(TAB_PREV)
    expect(getActiveTab()?.title).toBe('a')
    await executeCommand(TAB_NEXT)
    expect(getActiveTab()?.title).toBe('b')

    await executeCommand(TAB_TOGGLE_PIN)
    expect(getGroupTabs().map((t) => t.title)).toEqual(['b', 'a'])

    await executeCommand(TAB_CLOSE)
    await Promise.resolve()
    expect(getGroupTabs().map((t) => t.title)).toEqual(['a'])

    await executeCommand(TAB_REOPEN_CLOSED)
    expect(getActiveTab()?.title).toBe('b')
  })

  it('close others keeps the active tab', async () => {
    openTab(note('a'))
    openTab(note('b'))
    await executeCommand(TAB_CLOSE_OTHERS)
    await Promise.resolve()
    expect(getGroupTabs().map((t) => t.title)).toEqual(['b'])
  })
})
