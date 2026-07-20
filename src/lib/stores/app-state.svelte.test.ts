import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockIPC } from '@tauri-apps/api/mocks'
import {
  initAppState,
  getAppState,
  isAppStateReady,
  setAppStateField,
  addRecentItem,
  removeRecentItem,
  clearRecentItems,
  completeOnboarding,
  persistAppStateNow,
  __resetAppStateForTests,
} from './app-state.svelte'
import { defaultAppState, MAX_RECENT_ITEMS } from './app-state-schema'

beforeEach(() => {
  __resetAppStateForTests()
  vi.useRealTimers()
})

describe('initAppState', () => {
  it('loads state from backend and flips ready', async () => {
    mockIPC((cmd) => {
      if (cmd === 'load_app_state') {
        return {
          leftSidebarVisible: false,
          rightSidebarVisible: true,
          squareCorners: true,
          lastQuickPaneEntry: 'test',
          recentItems: ['a'],
          onboardingCompleted: true,
        }
      }
    })

    const result = await initAppState()
    expect(isAppStateReady()).toBe(true)
    expect(result.leftSidebarVisible).toBe(false)
    expect(result.squareCorners).toBe(true)
    expect(result.lastQuickPaneEntry).toBe('test')
    expect(result.recentItems).toEqual(['a'])
    expect(result.onboardingCompleted).toBe(true)
    expect(getAppState().leftSidebarVisible).toBe(false)
  })

  it('falls back to defaults on load error', async () => {
    mockIPC((cmd) => {
      if (cmd === 'load_app_state') {
        throw new Error('backend error')
      }
    })

    await initAppState()
    expect(isAppStateReady()).toBe(true)
    expect(getAppState()).toEqual(defaultAppState())
  })

  it('sanitizes invalid values from backend', async () => {
    mockIPC((cmd) => {
      if (cmd === 'load_app_state') {
        return {
          leftSidebarVisible: 'yes',
          rightSidebarVisible: true,
          squareCorners: false,
          lastQuickPaneEntry: null,
          recentItems: [],
          onboardingCompleted: false,
        }
      }
    })

    await initAppState()
    expect(getAppState().leftSidebarVisible).toBe(true)
    expect(getAppState().rightSidebarVisible).toBe(true)
  })
})

describe('setAppStateField', () => {
  it('updates state and schedules a debounced save', async () => {
    vi.useFakeTimers()
    const saveCalls: unknown[] = []

    mockIPC((cmd, args) => {
      if (cmd === 'load_app_state') {
        return defaultAppState()
      }
      if (cmd === 'save_app_state') {
        saveCalls.push(args)
        return null
      }
    })

    await initAppState()
    setAppStateField('leftSidebarVisible', false)
    expect(getAppState().leftSidebarVisible).toBe(false)

    expect(saveCalls).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(800)
    expect(saveCalls).toHaveLength(1)
  })
})

describe('persistAppStateNow', () => {
  it('flushes immediately without waiting for debounce', async () => {
    vi.useFakeTimers()
    const saveCalls: unknown[] = []

    mockIPC((cmd, args) => {
      if (cmd === 'load_app_state') {
        return defaultAppState()
      }
      if (cmd === 'save_app_state') {
        saveCalls.push(args)
        return null
      }
    })

    await initAppState()
    setAppStateField('rightSidebarVisible', false)
    await persistAppStateNow()
    expect(saveCalls).toHaveLength(1)
  })
})

describe('MRU helpers', () => {
  beforeEach(async () => {
    mockIPC((cmd) => {
      if (cmd === 'load_app_state') return defaultAppState()
      if (cmd === 'save_app_state') return null
    })
    await initAppState()
  })

  it('addRecentItem prepends and deduplicates', () => {
    addRecentItem('a')
    addRecentItem('b')
    addRecentItem('a')
    expect(getAppState().recentItems).toEqual(['a', 'b'])
  })

  it('addRecentItem caps at MAX_RECENT_ITEMS', () => {
    for (let i = 0; i < MAX_RECENT_ITEMS + 5; i++) {
      addRecentItem(`item-${i}`)
    }
    expect(getAppState().recentItems).toHaveLength(MAX_RECENT_ITEMS)
    expect(getAppState().recentItems[0]).toBe(`item-${MAX_RECENT_ITEMS + 4}`)
  })

  it('removeRecentItem filters out the item', () => {
    addRecentItem('a')
    addRecentItem('b')
    addRecentItem('c')
    removeRecentItem('b')
    expect(getAppState().recentItems).toEqual(['c', 'a'])
  })

  it('clearRecentItems empties the array', () => {
    addRecentItem('a')
    addRecentItem('b')
    clearRecentItems()
    expect(getAppState().recentItems).toEqual([])
  })
})

describe('completeOnboarding', () => {
  it('sets the onboarding flag', async () => {
    mockIPC((cmd) => {
      if (cmd === 'load_app_state') return defaultAppState()
      if (cmd === 'save_app_state') return null
    })

    await initAppState()
    expect(getAppState().onboardingCompleted).toBe(false)
    completeOnboarding()
    expect(getAppState().onboardingCompleted).toBe(true)
  })
})
