import type { PersistedAppState, PersistedTab } from '$lib/tauri-bindings'

export const MAX_RECENT_ITEMS = 20

/** Mirror the `MAX_*` tab caps in `src-tauri/src/types.rs`. */
export const MAX_OPEN_TABS = 100
export const MAX_TAB_ID_LEN = 256
export const MAX_TAB_KIND_LEN = 64
export const MAX_TAB_URI_LEN = 4096
export const MAX_TAB_TITLE_LEN = 512

const utf8 = new TextEncoder()

/** Rust caps are in UTF-8 bytes, so measure the same way. */
function fits(value: unknown, max: number): value is string {
  return typeof value === 'string' && utf8.encode(value).length <= max
}

/**
 * Returns the tab if every field is well-formed, otherwise `null`. A bad
 * tab is dropped rather than repaired: there is no sensible default URI.
 */
function sanitizeTab(raw: unknown): PersistedTab | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const t = raw as Partial<PersistedTab>
  if (!fits(t.id, MAX_TAB_ID_LEN) || t.id.length === 0) return null
  if (!fits(t.kind, MAX_TAB_KIND_LEN)) return null
  if (!fits(t.uri, MAX_TAB_URI_LEN)) return null
  if (!fits(t.title, MAX_TAB_TITLE_LEN)) return null
  return {
    id: t.id,
    kind: t.kind,
    uri: t.uri,
    title: t.title,
    pinned: typeof t.pinned === 'boolean' ? t.pinned : false,
  }
}

/** Keeps the first valid tab per id, capped at `MAX_OPEN_TABS`. */
function sanitizeTabs(raw: unknown): PersistedTab[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: PersistedTab[] = []
  for (const entry of raw) {
    const tab = sanitizeTab(entry)
    if (!tab || seen.has(tab.id)) continue
    seen.add(tab.id)
    out.push(tab)
    if (out.length === MAX_OPEN_TABS) break
  }
  return out
}

export function defaultAppState(): PersistedAppState {
  return {
    leftSidebarVisible: true,
    rightSidebarVisible: true,
    squareCorners: false,
    lastQuickPaneEntry: null,
    recentItems: [],
    onboardingCompleted: false,
    openTabs: [],
    activeTabId: null,
  }
}

export function sanitizeAppState(raw: unknown): PersistedAppState {
  const defaults = defaultAppState()
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw))
    return defaults

  const r = raw as Partial<PersistedAppState>
  const openTabs = sanitizeTabs(r.openTabs)
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
    openTabs,
    // Only an id that still names an open tab survives; anything else would
    // point the tab strip at nothing.
    activeTabId:
      typeof r.activeTabId === 'string' &&
      openTabs.some((t) => t.id === r.activeTabId)
        ? r.activeTabId
        : null,
  }
}
