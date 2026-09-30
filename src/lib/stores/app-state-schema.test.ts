import { describe, it, expect } from 'vitest'
import {
  defaultAppState,
  sanitizeAppState,
  MAX_OPEN_TABS,
  MAX_RECENT_ITEMS,
  MAX_TAB_URI_LEN,
  MAX_VAULT_ID_LEN,
} from './app-state-schema'

describe('defaultAppState', () => {
  it('returns expected defaults', () => {
    const defaults = defaultAppState()
    expect(defaults.leftSidebarVisible).toBe(true)
    expect(defaults.rightSidebarVisible).toBe(true)
    expect(defaults.squareCorners).toBe(false)
    expect(defaults.lastQuickPaneEntry).toBeNull()
    expect(defaults.recentItems).toEqual([])
    expect(defaults.onboardingCompleted).toBe(false)
    expect(defaults.openTabs).toEqual([])
    expect(defaults.activeTabId).toBeNull()
    expect(defaults.lastVaultId).toBeNull()
  })
})

describe('sanitizeAppState', () => {
  it('passes through a valid object unchanged', () => {
    const valid = {
      leftSidebarVisible: false,
      rightSidebarVisible: true,
      squareCorners: true,
      lastQuickPaneEntry: 'hello',
      recentItems: ['a', 'b'],
      onboardingCompleted: true,
      openTabs: [
        {
          id: 't1',
          kind: 'note',
          uri: 'vault://a.md',
          title: 'A',
          pinned: true,
        },
        {
          id: 't2',
          kind: 'pdf',
          uri: 'vault://b.pdf',
          title: 'B',
          pinned: false,
        },
      ],
      activeTabId: 't2',
      lastVaultId: 'vault-1',
    }
    expect(sanitizeAppState(valid)).toEqual(valid)
  })

  it('returns defaults for null', () => {
    expect(sanitizeAppState(null)).toEqual(defaultAppState())
  })

  it('returns defaults for non-object', () => {
    expect(sanitizeAppState('string')).toEqual(defaultAppState())
    expect(sanitizeAppState(42)).toEqual(defaultAppState())
  })

  it('returns defaults for array', () => {
    expect(sanitizeAppState([1, 2])).toEqual(defaultAppState())
  })

  it('falls back boolean fields to defaults on wrong type', () => {
    const result = sanitizeAppState({
      leftSidebarVisible: 'yes',
      rightSidebarVisible: 42,
      squareCorners: null,
      onboardingCompleted: undefined,
    })
    expect(result.leftSidebarVisible).toBe(true)
    expect(result.rightSidebarVisible).toBe(true)
    expect(result.squareCorners).toBe(false)
    expect(result.onboardingCompleted).toBe(false)
  })

  it('falls back lastQuickPaneEntry to null on wrong type', () => {
    const result = sanitizeAppState({ lastQuickPaneEntry: 123 })
    expect(result.lastQuickPaneEntry).toBeNull()
  })

  it('filters non-string entries from recentItems', () => {
    const result = sanitizeAppState({
      recentItems: ['a', 42, 'b', null, 'c'],
    })
    expect(result.recentItems).toEqual(['a', 'b', 'c'])
  })

  it('truncates recentItems to MAX_RECENT_ITEMS', () => {
    const items = Array.from({ length: 30 }, (_, i) => `item-${i}`)
    const result = sanitizeAppState({ recentItems: items })
    expect(result.recentItems).toHaveLength(MAX_RECENT_ITEMS)
    expect(result.recentItems[0]).toBe('item-0')
    expect(result.recentItems[MAX_RECENT_ITEMS - 1]).toBe(
      `item-${MAX_RECENT_ITEMS - 1}`,
    )
  })

  it('returns empty array for non-array recentItems', () => {
    const result = sanitizeAppState({ recentItems: 'not-array' })
    expect(result.recentItems).toEqual([])
  })

  it('fills in missing fields with defaults', () => {
    const result = sanitizeAppState({ leftSidebarVisible: false })
    expect(result.leftSidebarVisible).toBe(false)
    expect(result.rightSidebarVisible).toBe(true)
    expect(result.squareCorners).toBe(false)
    expect(result.lastQuickPaneEntry).toBeNull()
    expect(result.recentItems).toEqual([])
    expect(result.onboardingCompleted).toBe(false)
    expect(result.openTabs).toEqual([])
    expect(result.activeTabId).toBeNull()
    expect(result.lastVaultId).toBeNull()
  })

  it('keeps a well-formed lastVaultId and drops anything else', () => {
    expect(sanitizeAppState({ lastVaultId: 'abc' }).lastVaultId).toBe('abc')
    expect(sanitizeAppState({ lastVaultId: '' }).lastVaultId).toBeNull()
    expect(sanitizeAppState({ lastVaultId: 7 }).lastVaultId).toBeNull()
    expect(
      sanitizeAppState({ lastVaultId: 'x'.repeat(MAX_VAULT_ID_LEN + 1) })
        .lastVaultId,
    ).toBeNull()
  })

  const tab = (id: string) => ({
    id,
    kind: 'note',
    uri: `vault://${id}.md`,
    title: id,
    pinned: false,
  })

  it('drops malformed and duplicate tabs', () => {
    const result = sanitizeAppState({
      openTabs: [
        tab('a'),
        null,
        { ...tab('b'), uri: 42 },
        { ...tab(''), title: 'empty id' },
        { ...tab('c'), uri: 'x'.repeat(MAX_TAB_URI_LEN + 1) },
        { ...tab('a'), title: 'duplicate' },
        { ...tab('d'), pinned: 'yes' },
      ],
    })
    expect(result.openTabs).toEqual([tab('a'), tab('d')])
  })

  it('caps openTabs at MAX_OPEN_TABS', () => {
    const openTabs = Array.from({ length: MAX_OPEN_TABS + 5 }, (_, i) =>
      tab(`t${i}`),
    )
    const result = sanitizeAppState({ openTabs })
    expect(result.openTabs).toHaveLength(MAX_OPEN_TABS)
  })

  it('returns empty openTabs for a non-array', () => {
    expect(sanitizeAppState({ openTabs: 'nope' }).openTabs).toEqual([])
  })

  it('clears an activeTabId that names no open tab', () => {
    expect(
      sanitizeAppState({ openTabs: [tab('a')], activeTabId: 'gone' })
        .activeTabId,
    ).toBeNull()
    expect(
      sanitizeAppState({ openTabs: [tab('a')], activeTabId: 42 }).activeTabId,
    ).toBeNull()
    expect(
      sanitizeAppState({ openTabs: [tab('a')], activeTabId: 'a' }).activeTabId,
    ).toBe('a')
  })
})
