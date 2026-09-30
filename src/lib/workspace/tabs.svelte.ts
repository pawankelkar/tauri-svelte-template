/**
 * Workspace tabs.
 *
 * Tabs live in editor groups (`groups[].tabIds`, in strip order). Only one
 * group exists today, but every operation is written against "the group
 * that holds this tab" so splits can land without reshaping the store.
 *
 * Invariant: within a group, pinned tabs always come first.
 *
 * Persistence goes through the app-state store rather than a debounced
 * writer of its own: both would write the same `state.json`, and two
 * independent writers of one file race. Every mutation mirrors the strip
 * into `openTabs` / `activeTabId` via `setAppStateField`, which debounces
 * the save and is drained on quit by `flushAllStores()` (lifecycle.ts).
 * `dirty` and `preview` are session-only and never persisted.
 */
import type { PersistedAppState, PersistedTab } from '$lib/tauri-bindings'
import {
  MAX_OPEN_TABS,
  MAX_TAB_KIND_LEN,
  MAX_TAB_TITLE_LEN,
  MAX_TAB_URI_LEN,
} from '$lib/stores/app-state-schema'
import { setAppStateField } from '$lib/stores/app-state.svelte'
import { confirm } from '$lib/stores/confirm.svelte'
import { setUnsavedSource } from '$lib/stores/dirty.svelte'
import { logger } from '$lib/logger'

export interface Tab {
  id: string
  kind: string
  uri: string
  title: string
  /** Has unsaved changes. Feeds the quit gate; never persisted. */
  dirty: boolean
  pinned: boolean
  /**
   * A preview tab is replaced by the next preview open in its group, until
   * it is kept (edited, pinned, or opened again normally).
   */
  preview: boolean
}

export interface EditorGroup {
  id: string
  tabIds: string[]
  activeTabId: string | null
}

export interface OpenTabInput {
  kind: string
  uri: string
  title: string
}

export interface OpenTabOptions {
  /** Open as a preview tab (replaces the group's current preview tab). */
  preview?: boolean
  /** Open without activating. */
  background?: boolean
  pinned?: boolean
}

/**
 * Per-kind lifecycle hooks, so a view's model (a note's buffer) can act on
 * a tab closing even while its view is not mounted.
 *
 * - `beforeClose` runs first and may finish pending work (a note flushes
 *   its save), so a tab that only *looked* dirty closes without a prompt.
 * - `closed` runs after the tab is gone, however it went (closed, or a
 *   clean preview replaced by the next preview).
 */
export interface TabKindHooks {
  beforeClose?: (tab: Tab) => Promise<void> | void
  closed?: (tab: Tab) => void
}

// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never rendered
const _hooks = new Map<string, TabKindHooks>()

/** Installs the hooks for one tab kind; returns the uninstall function. */
export function setTabKindHooks(kind: string, hooks: TabKindHooks): () => void {
  _hooks.set(kind, hooks)
  return () => {
    if (_hooks.get(kind) === hooks) _hooks.delete(kind)
  }
}

const MAIN_GROUP_ID = 'main'
const UNSAVED_SOURCE = 'tabs'
const MAX_CLOSED_HISTORY = 20

function emptyGroup(): EditorGroup {
  return { id: MAIN_GROUP_ID, tabIds: [], activeTabId: null }
}

let _tabs = $state<Record<string, Tab>>({})
let _groups = $state<EditorGroup[]>([emptyGroup()])
let _activeGroupId = $state(MAIN_GROUP_ID)
let _closed: OpenTabInput[] = []
/**
 * Set by `initTabs`. Until then nothing is mirrored to app state: that
 * store still holds defaults, and a save scheduled now could overwrite the
 * user's real `state.json` with an empty strip.
 */
let _ready = false
let _seq = 0

const utf8 = new TextEncoder()

function byteLength(value: string): number {
  return utf8.encode(value).length
}

/** Shortens `value` by whole code points until it fits `maxBytes`. */
function truncateBytes(value: string, maxBytes: number): string {
  if (byteLength(value) <= maxBytes) return value
  let bytes = 0
  let out = ''
  for (const char of value) {
    bytes += byteLength(char)
    if (bytes > maxBytes) break
    out += char
  }
  return out
}

function newTabId(): string {
  let id: string
  do {
    _seq += 1
    id = `tab-${Date.now().toString(36)}-${_seq.toString(36)}`
  } while (id in _tabs)
  return id
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function getGroups(): EditorGroup[] {
  return _groups
}

export function getTab(id: string): Tab | undefined {
  return _tabs[id]
}

/** The tabs of a group in strip order (defaults to the active group). */
export function getGroupTabs(groupId: string = _activeGroupId): Tab[] {
  const group = findGroup(groupId)
  if (!group) return []
  return group.tabIds.map((id) => _tabs[id]).filter((t): t is Tab => !!t)
}

export function getTabCount(): number {
  return Object.keys(_tabs).length
}

function findGroup(groupId: string): EditorGroup | undefined {
  return _groups.find((g) => g.id === groupId)
}

function activeGroup(): EditorGroup {
  return findGroup(_activeGroupId) ?? _groups[0]!
}

function groupOf(tabId: string): EditorGroup | undefined {
  return _groups.find((g) => g.tabIds.includes(tabId))
}

export function getActiveTab(): Tab | undefined {
  const id = activeGroup().activeTabId
  return id ? _tabs[id] : undefined
}

export function findTabByUri(uri: string): Tab | undefined {
  return Object.values(_tabs).find((t) => t.uri === uri)
}

export function hasClosedTabs(): boolean {
  return _closed.length > 0
}

function pinnedCount(group: EditorGroup): number {
  return group.tabIds.filter((id) => _tabs[id]?.pinned).length
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/** The strip as it should be written to `state.json`. */
export function snapshotTabs(): Pick<
  PersistedAppState,
  'openTabs' | 'activeTabId'
> {
  const openTabs: PersistedTab[] = []
  for (const group of _groups) {
    for (const id of group.tabIds) {
      const tab = _tabs[id]
      if (!tab) continue
      openTabs.push({
        id: tab.id,
        kind: tab.kind,
        uri: tab.uri,
        title: truncateBytes(tab.title, MAX_TAB_TITLE_LEN),
        pinned: tab.pinned,
      })
    }
  }
  return {
    openTabs: openTabs.slice(0, MAX_OPEN_TABS),
    activeTabId: activeGroup().activeTabId,
  }
}

function persist(): void {
  if (!_ready) return
  const { openTabs, activeTabId } = snapshotTabs()
  setAppStateField('openTabs', openTabs)
  setAppStateField('activeTabId', activeTabId)
}

function syncUnsaved(): void {
  setUnsavedSource(
    UNSAVED_SOURCE,
    Object.values(_tabs).some((t) => t.dirty),
  )
}

/**
 * Restores the strip from loaded (already sanitised) app state. Tabs opened
 * before this ran — a deep link that arrived during boot — are kept after
 * the restored ones and stay focused.
 */
export function initTabs(state: PersistedAppState): void {
  const early = getGroupTabs(MAIN_GROUP_ID)
  const earlyActive = activeGroup().activeTabId

  const tabs: Record<string, Tab> = {}
  // A local scratch set, never read reactively.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const seenUris = new Set<string>()
  const pinned: string[] = []
  const unpinned: string[] = []

  for (const saved of state.openTabs) {
    if (saved.id in tabs || seenUris.has(saved.uri)) continue
    seenUris.add(saved.uri)
    tabs[saved.id] = { ...saved, dirty: false, preview: false }
    ;(saved.pinned ? pinned : unpinned).push(saved.id)
  }
  for (const tab of early) {
    if (seenUris.has(tab.uri) || tab.id in tabs) continue
    if (pinned.length + unpinned.length >= MAX_OPEN_TABS) break
    seenUris.add(tab.uri)
    tabs[tab.id] = { ...tab }
    ;(tab.pinned ? pinned : unpinned).push(tab.id)
  }

  const tabIds = [...pinned, ...unpinned]
  // A deep link opened during boot that duplicated a restored tab should
  // still focus it.
  const earlyUri = earlyActive ? _tabs[earlyActive]?.uri : undefined
  const earlyMatch = earlyUri
    ? Object.values(tabs).find((t) => t.uri === earlyUri)?.id
    : undefined
  let activeTabId = earlyMatch ?? state.activeTabId
  if (!activeTabId || !(activeTabId in tabs)) activeTabId = tabIds[0] ?? null

  _tabs = tabs
  _groups = [{ id: MAIN_GROUP_ID, tabIds, activeTabId }]
  _activeGroupId = MAIN_GROUP_ID
  _ready = true
  syncUnsaved()
  if (early.length > 0) persist()
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Opens a tab, or focuses the existing tab for the same URI. Returns the
 * tab id, or `null` if the tab cannot be opened (the strip is full, or the
 * URI/kind is too long to persist).
 */
export function openTab(
  input: OpenTabInput,
  options: OpenTabOptions = {},
): string | null {
  const existing = findTabByUri(input.uri)
  if (existing) {
    if (!options.preview) existing.preview = false
    if (options.pinned && !existing.pinned) pinTab(existing.id)
    if (!options.background) activateTab(existing.id)
    persist()
    return existing.id
  }

  if (
    byteLength(input.uri) > MAX_TAB_URI_LEN ||
    byteLength(input.kind) > MAX_TAB_KIND_LEN ||
    input.kind === ''
  ) {
    logger.warn('Refusing to open a tab that cannot be persisted', input.kind)
    return null
  }

  const group = activeGroup()
  const replaced = options.preview ? findReplaceablePreview(group) : undefined
  if (!replaced && getTabCount() >= MAX_OPEN_TABS) {
    logger.warn(`Refusing to open more than ${MAX_OPEN_TABS} tabs`)
    return null
  }

  const pinned = options.pinned === true
  const tab: Tab = {
    id: newTabId(),
    kind: input.kind,
    uri: input.uri,
    title: truncateBytes(input.title, MAX_TAB_TITLE_LEN),
    dirty: false,
    pinned,
    preview: options.preview === true && !pinned,
  }
  _tabs[tab.id] = tab

  if (replaced) {
    const index = group.tabIds.indexOf(replaced.id)
    group.tabIds[index] = tab.id
    if (group.activeTabId === replaced.id) group.activeTabId = tab.id
    delete _tabs[replaced.id]
    notifyClosed(replaced)
  } else {
    group.tabIds.splice(insertionIndex(group, pinned), 0, tab.id)
  }

  if (!options.background || group.activeTabId === null) {
    group.activeTabId = tab.id
  }
  persist()
  return tab.id
}

function findReplaceablePreview(group: EditorGroup): Tab | undefined {
  return group.tabIds
    .map((id) => _tabs[id])
    .find((t): t is Tab => !!t && t.preview && !t.dirty && !t.pinned)
}

/**
 * New tabs go right after the active tab, like a browser. Pinned tabs go at
 * the end of the pinned block; unpinned ones never land inside it.
 */
function insertionIndex(group: EditorGroup, pinned: boolean): number {
  const pins = pinnedCount(group)
  if (pinned) return pins
  const activeIndex = group.activeTabId
    ? group.tabIds.indexOf(group.activeTabId)
    : -1
  if (activeIndex === -1) return group.tabIds.length
  return Math.max(activeIndex + 1, pins)
}

export function activateTab(id: string): void {
  const group = groupOf(id)
  if (!group) return
  _activeGroupId = group.id
  if (group.activeTabId === id) return
  group.activeTabId = id
  persist()
}

/**
 * Closes a tab. A dirty tab asks first (unless `force`); resolves to
 * whether the tab was closed. Closing the active tab focuses its right-hand
 * neighbour, or the left-hand one if it was last.
 */
export async function closeTab(
  id: string,
  options: { force?: boolean } = {},
): Promise<boolean> {
  const tab = _tabs[id]
  if (!tab) return false
  try {
    await _hooks.get(tab.kind)?.beforeClose?.(tab)
  } catch (e) {
    logger.warn('A tab close hook failed', e)
  }
  if (!_tabs[id]) return false
  if (tab.dirty && !options.force) {
    const proceed = await confirm({
      titleKey: 'workspace.closeDirty.title',
      titleOptions: { title: tab.title },
      descriptionKey: 'workspace.closeDirty.description',
      confirmKey: 'workspace.closeDirty.confirm',
      cancelKey: 'workspace.closeDirty.cancel',
      destructive: true,
    })
    // The tab may have been closed some other way while the prompt was up.
    if (!proceed || !_tabs[id]) return false
  }
  removeTab(id)
  return true
}

function removeTab(id: string): void {
  const tab = _tabs[id]
  const group = groupOf(id)
  if (!tab || !group) return

  const index = group.tabIds.indexOf(id)
  group.tabIds.splice(index, 1)
  if (group.activeTabId === id) {
    group.activeTabId =
      group.tabIds[Math.min(index, group.tabIds.length - 1)] ?? null
  }
  delete _tabs[id]

  _closed.push({ kind: tab.kind, uri: tab.uri, title: tab.title })
  if (_closed.length > MAX_CLOSED_HISTORY) _closed.shift()

  if (tab.dirty) syncUnsaved()
  persist()
  notifyClosed(tab)
}

function notifyClosed(tab: Tab): void {
  try {
    _hooks.get(tab.kind)?.closed?.(tab)
  } catch (e) {
    logger.warn('A tab close hook failed', e)
  }
}

/**
 * Closes every unpinned tab in `id`'s group except `id` itself. Dirty tabs
 * each ask; a declined one stays open. Resolves to how many were closed.
 */
export async function closeOtherTabs(id: string): Promise<number> {
  const group = groupOf(id)
  if (!group) return 0
  const targets = group.tabIds.filter(
    (other) => other !== id && !_tabs[other]?.pinned,
  )
  let closed = 0
  for (const other of targets) {
    if (await closeTab(other)) closed += 1
  }
  activateTab(id)
  return closed
}

/** Reopens the most recently closed tab. Returns its id, or `null`. */
export function reopenClosedTab(): string | null {
  const last = _closed.pop()
  return last ? openTab(last) : null
}

function cycle(delta: 1 | -1): void {
  const group = activeGroup()
  const count = group.tabIds.length
  if (count === 0) return
  const index = group.activeTabId ? group.tabIds.indexOf(group.activeTabId) : 0
  const next = group.tabIds[(index + delta + count) % count]!
  activateTab(next)
}

export function nextTab(): void {
  cycle(1)
}

export function prevTab(): void {
  cycle(-1)
}

/**
 * Moves the tab at index `from` to index `to` in the active group. The
 * target is clamped so pinned and unpinned tabs never interleave.
 */
export function moveTab(
  from: number,
  to: number,
  groupId: string = _activeGroupId,
): void {
  const group = findGroup(groupId)
  if (!group) return
  const id = group.tabIds[from]
  if (id === undefined) return
  const pins = pinnedCount(group)
  const [min, max] = _tabs[id]?.pinned
    ? [0, pins - 1]
    : [pins, group.tabIds.length - 1]
  const target = Math.min(Math.max(to, min), max)
  if (target === from) return
  group.tabIds.splice(from, 1)
  group.tabIds.splice(target, 0, id)
  persist()
}

/** Pins a tab, moving it to the end of the pinned block. */
export function pinTab(id: string): void {
  const tab = _tabs[id]
  const group = groupOf(id)
  if (!tab || !group || tab.pinned) return
  const pins = pinnedCount(group)
  group.tabIds.splice(group.tabIds.indexOf(id), 1)
  group.tabIds.splice(pins, 0, id)
  tab.pinned = true
  tab.preview = false
  persist()
}

/** Unpins a tab, moving it to the start of the unpinned block. */
export function unpinTab(id: string): void {
  const tab = _tabs[id]
  const group = groupOf(id)
  if (!tab || !group || !tab.pinned) return
  group.tabIds.splice(group.tabIds.indexOf(id), 1)
  tab.pinned = false
  group.tabIds.splice(pinnedCount(group), 0, id)
  persist()
}

export function togglePinTab(id: string): void {
  if (_tabs[id]?.pinned) unpinTab(id)
  else pinTab(id)
}

/** Promotes a preview tab to a normal one. */
export function keepTab(id: string): void {
  const tab = _tabs[id]
  if (tab) tab.preview = false
}

export function setTabDirty(id: string, dirty: boolean): void {
  const tab = _tabs[id]
  if (!tab || tab.dirty === dirty) return
  tab.dirty = dirty
  // Editing a preview tab keeps it — it must not be silently replaced.
  if (dirty) tab.preview = false
  syncUnsaved()
}

export function setTabTitle(id: string, title: string): void {
  const tab = _tabs[id]
  if (!tab) return
  const next = truncateBytes(title, MAX_TAB_TITLE_LEN)
  if (tab.title === next) return
  tab.title = next
  persist()
}

/**
 * Points a tab at a new URI and title — a note that was renamed or moved
 * keeps its tab (and its place in the strip) instead of closing. Ignored
 * when another tab already shows `uri`.
 */
export function retargetTab(id: string, uri: string, title: string): void {
  const tab = _tabs[id]
  if (!tab || tab.uri === uri) return
  if (findTabByUri(uri) || byteLength(uri) > MAX_TAB_URI_LEN) return
  tab.uri = uri
  tab.title = truncateBytes(title, MAX_TAB_TITLE_LEN)
  persist()
}

/** Every open tab of one kind, across groups. */
export function getTabsOfKind(kind: string): Tab[] {
  return Object.values(_tabs).filter((t) => t.kind === kind)
}

export function __resetTabsForTests(): void {
  _tabs = {}
  _groups = [emptyGroup()]
  _activeGroupId = MAIN_GROUP_ID
  _closed = []
  _ready = false
  _seq = 0
  _hooks.clear()
  syncUnsaved()
}
