import { getAppState, setAppStateField } from './app-state.svelte'

export function isLeftSidebarVisible(): boolean {
  return getAppState().leftSidebarVisible
}

export function isRightSidebarVisible(): boolean {
  return getAppState().rightSidebarVisible
}

export function getSquareCorners(): boolean {
  return getAppState().squareCorners
}

export function getLastQuickPaneEntry(): string | null {
  return getAppState().lastQuickPaneEntry
}

export function setLeftSidebarVisible(v: boolean): void {
  setAppStateField('leftSidebarVisible', v)
}

export function setRightSidebarVisible(v: boolean): void {
  setAppStateField('rightSidebarVisible', v)
}

export function setSquareCorners(v: boolean): void {
  setAppStateField('squareCorners', v)
}

export function setLastQuickPaneEntry(v: string | null): void {
  setAppStateField('lastQuickPaneEntry', v)
}

export function toggleLeftSidebar(): void {
  setLeftSidebarVisible(!isLeftSidebarVisible())
}

export function toggleRightSidebar(): void {
  setRightSidebarVisible(!isRightSidebarVisible())
}
