import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('$lib/stores/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))
vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir: vi.fn() }))

import { revealItemInDir } from '@tauri-apps/plugin-opener'
import type { TreeNode } from '$lib/tauri-bindings'
import { installFakeBackend } from '../../../test/fake-backend'
import { resetAllStores, resetVaultStores } from '../../../test/reset-stores'
import { defaultAppState } from '$lib/stores/app-state-schema'
import { initTabs } from '$lib/workspace/tabs.svelte'
import { getTreeRenameRequest } from '$lib/workspace/rename-requests.svelte'
import { findTreeNode, initVault } from '$lib/stores/vault.svelte'
import { initNotes } from '$lib/stores/notes.svelte'
import { getTreeSelection, isExpanded } from '$lib/stores/tree-state.svelte'
import {
  absolutePath,
  entryMenu,
  newFolderIn,
  revealEntry,
  targetFolder,
  uniqueName,
} from './file-tree-actions'

let cleanups: (() => void)[] = []

const node = (path: string, kind: TreeNode['kind']): TreeNode =>
  ({
    path,
    kind,
    name: path.split('/').pop()!,
    children: [],
  }) as unknown as TreeNode

beforeEach(async () => {
  resetAllStores()
  resetVaultStores()
  installFakeBackend({ open: true })
  initTabs(defaultAppState())
  cleanups = [await initVault(null), initNotes()]
})

afterEach(() => {
  for (const cleanup of cleanups) cleanup()
})

describe('file tree actions', () => {
  it('picks the folder new entries go in', () => {
    expect(targetFolder(null)).toBe('')
    expect(targetFolder(node('Projects', 'folder'))).toBe('Projects')
    expect(targetFolder(node('Projects/a.md', 'note'))).toBe('Projects')
  })

  it('numbers a name until it is free, ignoring case', () => {
    expect(uniqueName('Untitled', [])).toBe('Untitled')
    expect(uniqueName('Untitled', ['untitled', 'Untitled 2'])).toBe(
      'Untitled 3',
    )
  })

  it('builds absolute paths in the vault separator', () => {
    expect(absolutePath('A/b.md')).toBe('/Users/me/Notes/A/b.md')
    expect(absolutePath('')).toBe('/Users/me/Notes')
  })

  it('reveals the absolute path', async () => {
    await revealEntry('Welcome.md')
    expect(revealItemInDir).toHaveBeenCalledWith('/Users/me/Notes/Welcome.md')
  })

  it('offers only creation on the empty area', () => {
    const ids = entryMenu(null).map((e) => ('id' in e ? e.id : '-'))
    expect(ids).toEqual(['tree-new-note', 'tree-new-folder'])
  })

  it('offers rename, trash, reveal and copy on a row', () => {
    const ids = entryMenu(node('Ideas.md', 'note')).map((e) =>
      'id' in e ? e.id : '-',
    )
    expect(ids).toEqual([
      'tree-new-note',
      'tree-new-folder',
      '-',
      'tree-rename',
      'tree-trash',
      '-',
      'tree-reveal',
      'tree-copy-path',
    ])
  })

  it('creates a numbered folder, expands its parent and starts a rename', async () => {
    await newFolderIn('Projects')
    await newFolderIn('Projects')
    const second = getTreeSelection()!
    expect(second).toMatch(/^Projects\/.+ 2$/)
    expect(findTreeNode(second)?.kind).toBe('folder')
    expect(isExpanded('Projects')).toBe(true)
    expect(getTreeRenameRequest()?.target).toBe(second)
  })
})
