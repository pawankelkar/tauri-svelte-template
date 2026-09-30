import { describe, it, expect, beforeEach } from 'vitest'
import {
  getLeftActivity,
  getRightPanel,
  getSearchFocusRequest,
  getSearchQuery,
  setLeftActivity,
  setRightPanel,
  showSearch,
  __resetSidebarForTests,
} from './sidebar.svelte'
import {
  isCreateVaultOpen,
  isQuickOpenOpen,
  isVaultSwitcherOpen,
  setCreateVaultOpen,
  setVaultSwitcherOpen,
  toggleQuickOpen,
  __resetOverlaysForTests,
} from './overlays.svelte'
import { isLeftSidebarVisible, setLeftSidebarVisible } from './ui.svelte'

beforeEach(() => {
  __resetSidebarForTests()
  __resetOverlaysForTests()
})

describe('sidebar', () => {
  it('starts on the file tree and the outline', () => {
    expect(getLeftActivity()).toBe('files')
    expect(getRightPanel()).toBe('outline')
    setLeftActivity('search')
    setRightPanel('backlinks')
    expect(getLeftActivity()).toBe('search')
    expect(getRightPanel()).toBe('backlinks')
  })

  it('showSearch reveals the sidebar, keeps or sets the query and asks for focus', () => {
    setLeftSidebarVisible(false)
    const before = getSearchFocusRequest()
    showSearch('garden')
    expect(isLeftSidebarVisible()).toBe(true)
    expect(getLeftActivity()).toBe('search')
    expect(getSearchQuery()).toBe('garden')
    showSearch()
    expect(getSearchQuery()).toBe('garden')
    expect(getSearchFocusRequest()).toBe(before + 2)
  })
})

describe('overlays', () => {
  it('toggles each overlay independently', () => {
    toggleQuickOpen()
    setCreateVaultOpen(true)
    expect(isQuickOpenOpen()).toBe(true)
    expect(isCreateVaultOpen()).toBe(true)
    expect(isVaultSwitcherOpen()).toBe(false)
    toggleQuickOpen()
    setVaultSwitcherOpen(true)
    expect(isQuickOpenOpen()).toBe(false)
    expect(isVaultSwitcherOpen()).toBe(true)
  })
})
