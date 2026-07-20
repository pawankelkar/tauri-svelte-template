import type { PersistedAppState } from '$lib/tauri-bindings'

export const MAX_RECENT_ITEMS = 20

export function defaultAppState(): PersistedAppState {
  return {
    leftSidebarVisible: true,
    rightSidebarVisible: true,
    squareCorners: false,
    lastQuickPaneEntry: null,
    recentItems: [],
    onboardingCompleted: false,
  }
}

export function sanitizeAppState(raw: unknown): PersistedAppState {
  const defaults = defaultAppState()
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw))
    return defaults

  const r = raw as Partial<PersistedAppState>
  return {
    leftSidebarVisible:
      typeof r.leftSidebarVisible === 'boolean'
        ? r.leftSidebarVisible
        : defaults.leftSidebarVisible,
    rightSidebarVisible:
      typeof r.rightSidebarVisible === 'boolean'
        ? r.rightSidebarVisible
        : defaults.rightSidebarVisible,
    squareCorners:
      typeof r.squareCorners === 'boolean'
        ? r.squareCorners
        : defaults.squareCorners,
    lastQuickPaneEntry:
      typeof r.lastQuickPaneEntry === 'string' ? r.lastQuickPaneEntry : null,
    recentItems: Array.isArray(r.recentItems)
      ? r.recentItems
          .filter((x): x is string => typeof x === 'string')
          .slice(0, MAX_RECENT_ITEMS)
      : [],
    onboardingCompleted:
      typeof r.onboardingCompleted === 'boolean'
        ? r.onboardingCompleted
        : defaults.onboardingCompleted,
  }
}
