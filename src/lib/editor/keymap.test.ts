import { describe, it, expect, beforeEach } from 'vitest'
import { BLOCKED_EDITOR_KEYS, appCommandForKey, editorBindings } from './keymap'
import {
  registerCommands,
  __resetCommandsForTests,
} from '$lib/commands/registry.svelte'
import {
  resetContextKeys,
  setContextKey,
} from '$lib/commands/context-keys.svelte'

function key(init: KeyboardEventInit) {
  return new KeyboardEvent('keydown', init)
}

beforeEach(() => {
  __resetCommandsForTests()
  resetContextKeys()
  registerCommands([
    {
      id: 'test.inInput',
      labelKey: 'x',
      category: 'x',
      shortcut: 'mod+b',
      allowInInput: true,
      when: 'editorTextFocus',
      run: () => {},
    },
    {
      id: 'test.notInInput',
      labelKey: 'x',
      category: 'x',
      shortcut: 'mod+k',
      run: () => {},
    },
  ])
})

describe('editor keymap', () => {
  it('drops CodeMirror bindings on chords the app owns', () => {
    const keys = editorBindings().flatMap((b) => [b.key, b.mac])
    for (const blocked of BLOCKED_EDITOR_KEYS)
      expect(keys).not.toContain(blocked)
    // Ordinary editing keys survive.
    expect(keys).toContain('Mod-z')
  })

  it('hands app chords allowed in text fields to the command', () => {
    setContextKey('editorTextFocus', true)
    expect(appCommandForKey(key({ key: 'b', metaKey: true }))).toBe(
      'test.inInput',
    )
  })

  it('leaves other chords to CodeMirror', () => {
    setContextKey('editorTextFocus', true)
    expect(appCommandForKey(key({ key: 'k', metaKey: true }))).toBeUndefined()
    expect(appCommandForKey(key({ key: 'b' }))).toBeUndefined()
    setContextKey('editorTextFocus', false)
    expect(appCommandForKey(key({ key: 'b', ctrlKey: true }))).toBeUndefined()
  })
})
