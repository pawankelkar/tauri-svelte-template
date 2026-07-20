import { describe, it, expect, beforeEach } from 'vitest'
import { mockIPC } from '@tauri-apps/api/mocks'
import {
  isLeftSidebarVisible,
  isRightSidebarVisible,
  getSquareCorners,
  getLastQuickPaneEntry,
  setLeftSidebarVisible,
  setRightSidebarVisible,
  setSquareCorners,
  setLastQuickPaneEntry,
  toggleLeftSidebar,
  toggleRightSidebar,
} from './ui.svelte'
import { initAppState, __resetAppStateForTests } from './app-state.svelte'
import { defaultAppState } from './app-state-schema'

beforeEach(async () => {
  __resetAppStateForTests()
  mockIPC((cmd) => {
    if (cmd === 'load_app_state') return defaultAppState()
    if (cmd === 'save_app_state') return null
  })
  await initAppState()
})

describe('sidebar visibility', () => {
  it('starts with both sidebars visible', () => {
    expect(isLeftSidebarVisible()).toBe(true)
    expect(isRightSidebarVisible()).toBe(true)
  })

  it('toggleLeftSidebar flips visibility', () => {
    toggleLeftSidebar()
    expect(isLeftSidebarVisible()).toBe(false)
    toggleLeftSidebar()
    expect(isLeftSidebarVisible()).toBe(true)
  })

  it('toggleRightSidebar flips visibility', () => {
    toggleRightSidebar()
    expect(isRightSidebarVisible()).toBe(false)
    toggleRightSidebar()
    expect(isRightSidebarVisible()).toBe(true)
  })

  it('setLeftSidebarVisible sets directly', () => {
    setLeftSidebarVisible(false)
    expect(isLeftSidebarVisible()).toBe(false)
    setLeftSidebarVisible(true)
    expect(isLeftSidebarVisible()).toBe(true)
  })

  it('setRightSidebarVisible sets directly', () => {
    setRightSidebarVisible(false)
    expect(isRightSidebarVisible()).toBe(false)
  })
})

describe('squareCorners', () => {
  it('starts as false', () => {
    expect(getSquareCorners()).toBe(false)
  })

  it('setSquareCorners updates the value', () => {
    setSquareCorners(true)
    expect(getSquareCorners()).toBe(true)
    setSquareCorners(false)
    expect(getSquareCorners()).toBe(false)
  })
})

describe('lastQuickPaneEntry', () => {
  it('starts as null', () => {
    expect(getLastQuickPaneEntry()).toBeNull()
  })

  it('setLastQuickPaneEntry updates the value', () => {
    setLastQuickPaneEntry('test input')
    expect(getLastQuickPaneEntry()).toBe('test input')
    setLastQuickPaneEntry(null)
    expect(getLastQuickPaneEntry()).toBeNull()
  })
})
