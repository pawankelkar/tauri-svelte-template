import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { installFakeBackend } from '../../test/fake-backend'
import { resetVaultStores } from '../../test/reset-stores'
import {
  closeCurrentVault,
  getCurrentVault,
  initVault,
  openVaultAt,
} from './vault.svelte'
import {
  expandAncestors,
  getTreeSelection,
  initTreeState,
  isExpanded,
  remapTreeState,
  setExpanded,
  setTreeSelection,
  toggleExpanded,
} from './tree-state.svelte'

let cleanups: (() => void)[] = []

beforeEach(async () => {
  resetVaultStores()
  installFakeBackend({ open: true })
  cleanups = [initTreeState(), await initVault(null)]
})

afterEach(() => {
  for (const cleanup of cleanups) cleanup()
})

describe('tree state', () => {
  it('expands, collapses and reveals ancestors', () => {
    toggleExpanded('Projects')
    expect(isExpanded('Projects')).toBe(true)
    toggleExpanded('Projects')
    expect(isExpanded('Projects')).toBe(false)
    expandAncestors('Projects/Research/CRDT Reading List.md')
    expect(isExpanded('Projects')).toBe(true)
    expect(isExpanded('Projects/Research')).toBe(true)
    expect(isExpanded('Projects/Research/CRDT Reading List.md')).toBe(false)
  })

  it('remembers expanded folders per vault across reopen', async () => {
    const id = getCurrentVault()!.id
    setExpanded('Projects', true)
    setTreeSelection('Projects')
    expect(localStorage.getItem(`ostralith.tree.expanded.${id}`)).toContain(
      'Projects',
    )
    await closeCurrentVault()
    expect(isExpanded('Projects')).toBe(false)
    expect(getTreeSelection()).toBeNull()
    await openVaultAt(getRecentPath())
    expect(isExpanded('Projects')).toBe(true)
  })

  it('follows a rename with its expanded children and the selection', () => {
    setExpanded('Projects', true)
    setExpanded('Projects/Research', true)
    setTreeSelection('Projects/Research/CRDT Reading List.md')
    remapTreeState('Projects', 'Work')
    expect(isExpanded('Work')).toBe(true)
    expect(isExpanded('Work/Research')).toBe(true)
    expect(isExpanded('Projects')).toBe(false)
    expect(getTreeSelection()).toBe('Work/Research/CRDT Reading List.md')
  })
})

function getRecentPath(): string {
  return '/Users/me/Notes'
}
