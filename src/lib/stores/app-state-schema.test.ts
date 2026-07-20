import { describe, it, expect } from 'vitest'
import {
  defaultAppState,
  sanitizeAppState,
  MAX_RECENT_ITEMS,
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
  })
})
