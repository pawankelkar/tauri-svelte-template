import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('$lib/stores/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))

import { installFakeBackend, type FakeBackend } from '../../test/fake-backend'
import { resetAllStores, resetVaultStores } from '../../test/reset-stores'
import { defaultAppState } from '$lib/stores/app-state-schema'
import { getActiveTab, initTabs } from '$lib/workspace/tabs.svelte'
import { notePathOfTab, openNote } from '$lib/workspace/open-note'
import {
  getTitleRenameRequest,
  getTreeRenameRequest,
} from '$lib/workspace/rename-requests.svelte'
import {
  registerEditor,
  type EditorHandle,
} from '$lib/editor/editor-registry.svelte'
import { closeCurrentVault, initVault } from '$lib/stores/vault.svelte'
import {
  ensureDoc,
  getDoc,
  initNotes,
  updateDocContent,
} from '$lib/stores/notes.svelte'
import { setTreeSelection } from '$lib/stores/tree-state.svelte'
import { getLeftActivity, getSearchQuery } from '$lib/stores/sidebar.svelte'
import {
  isCreateVaultOpen,
  isQuickOpenOpen,
  isVaultSwitcherOpen,
} from '$lib/stores/overlays.svelte'
import { registerAppCommands } from './app-commands'
import { registerTabCommands } from './tab-commands'
import {
  EDITOR_BOLD,
  NOTE_NEW,
  NOTE_QUICK_OPEN,
  NOTE_RENAME,
  NOTE_SAVE,
  SEARCH_FIND,
  SEARCH_VAULT,
  registerNoteCommands,
} from './note-commands'
import {
  BACKUP_NOW,
  VAULT_CREATE,
  VAULT_SWITCH,
  registerVaultCommands,
} from './vault-commands'
import {
  executeCommand,
  getCommand,
  isCommandEnabled,
  listCommands,
  resolveShortcut,
  __resetCommandsForTests,
} from './registry.svelte'
import { setContextKey } from './context-keys.svelte'
import { findShortcutConflict, isBlockingConflict } from './command-shortcuts'

let backend: FakeBackend
let cleanups: (() => void)[] = []

function fakeEditor(selected = ''): EditorHandle {
  return {
    focus: vi.fn(),
    reveal: vi.fn(),
    toggleBold: vi.fn(),
    toggleItalic: vi.fn(),
    openFind: vi.fn(),
    selectedText: () => selected,
  }
}

const enabled = (id: string) => isCommandEnabled(getCommand(id)!)

beforeEach(async () => {
  vi.clearAllMocks()
  resetAllStores()
  resetVaultStores()
  __resetCommandsForTests()
  backend = installFakeBackend({ open: true })
  initTabs(defaultAppState())
  cleanups = [await initVault(null), initNotes()]
  registerAppCommands()
  registerTabCommands()
  registerNoteCommands()
  registerVaultCommands()
})

afterEach(() => {
  for (const cleanup of cleanups) cleanup()
})

describe('default keymap', () => {
  it('has no blocking conflicts between built-in shortcuts', () => {
    const clashes = listCommands()
      .filter((c) => c.shortcut)
      .map((c) => ({
        id: c.id,
        conflict: findShortcutConflict(c.shortcut!, c.id),
      }))
      .filter((c) => c.conflict && isBlockingConflict(c.conflict))
    expect(clashes).toEqual([])
  })

  it('binds the note chords', () => {
    expect(resolveShortcut('mod+n')?.id).toBe(NOTE_NEW)
    expect(resolveShortcut('mod+o')?.id).toBe(NOTE_QUICK_OPEN)
    expect(resolveShortcut('mod+shift+f')?.id).toBe(SEARCH_VAULT)
  })
})

describe('note commands', () => {
  it('are disabled without a vault', async () => {
    await closeCurrentVault()
    expect(enabled(NOTE_NEW)).toBe(false)
    expect(enabled(NOTE_QUICK_OPEN)).toBe(false)
    expect(getCommand(VAULT_SWITCH)?.when).toBeUndefined()
    expect(enabled(BACKUP_NOW)).toBe(false)
  })

  it('create a note and open it', async () => {
    await executeCommand(NOTE_NEW)
    await vi.waitFor(() =>
      expect(notePathOfTab(getActiveTab())).toMatch(/\.md$/),
    )
    expect(backend.commandNames()).toContain('create_note')
  })

  it('save the active note now', async () => {
    openNote('Welcome.md')
    await ensureDoc('Welcome.md')
    updateDocContent('Welcome.md', 'now')
    await executeCommand(NOTE_SAVE)
    await vi.waitFor(() => expect(getDoc('Welcome.md')?.dirty).toBe(false))
  })

  it('rename the tree selection when the tree has focus, the tab otherwise', async () => {
    openNote('Welcome.md')
    await executeCommand(NOTE_RENAME)
    expect(getTitleRenameRequest()?.target).toBe(getActiveTab()!.id)

    setTreeSelection('Ideas.md')
    setContextKey('fileTreeFocus', true)
    await executeCommand(NOTE_RENAME)
    expect(getTreeRenameRequest()?.target).toBe('Ideas.md')
  })

  it('find in the note with an editor, in the vault without', async () => {
    await executeCommand(SEARCH_FIND)
    expect(getLeftActivity()).toBe('search')

    const id = openNote('Welcome.md')!
    const editor = fakeEditor()
    registerEditor(id, editor)
    await executeCommand(SEARCH_FIND)
    expect(editor.openFind).toHaveBeenCalled()
  })

  it('search the vault for the selected text', async () => {
    const id = openNote('Welcome.md')!
    registerEditor(id, fakeEditor('garden'))
    await executeCommand(SEARCH_VAULT)
    expect(getSearchQuery()).toBe('garden')
  })

  it('format only with a focused editor', async () => {
    const id = openNote('Welcome.md')!
    const editor = fakeEditor()
    registerEditor(id, editor)
    expect(resolveShortcut('mod+b')?.id).not.toBe(EDITOR_BOLD)
    setContextKey('editorTextFocus', true)
    expect(resolveShortcut('mod+b')?.id).toBe(EDITOR_BOLD)
    await executeCommand(EDITOR_BOLD)
    expect(editor.toggleBold).toHaveBeenCalled()
  })

  it('toggle quick open and open the vault dialogs', async () => {
    await executeCommand(NOTE_QUICK_OPEN)
    expect(isQuickOpenOpen()).toBe(true)
    await executeCommand(VAULT_CREATE)
    expect(isCreateVaultOpen()).toBe(true)
    await executeCommand(VAULT_SWITCH)
    expect(isVaultSwitcherOpen()).toBe(true)
  })
})
