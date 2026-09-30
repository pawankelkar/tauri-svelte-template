/**
 * Back / forward navigation across tabs, like a browser's history.
 *
 * Every time a different tab becomes active its target is recorded. Going
 * back reopens the previous entry (the tab may have been closed since), and
 * a visit made after going back drops the forward entries.
 *
 * Entries for notes that no longer exist (trashed, renamed or deleted
 * outside the app) are skipped rather than reopened as broken tabs.
 */
import { untrack } from 'svelte'
import { onVaultChange, findTreeNode } from '$lib/stores/vault.svelte'
import { getActiveTab, openTab, type OpenTabInput } from './tabs.svelte'
import { NOTE_VIEW_KIND } from './open-note'
import { parseUri } from './uri'

const MAX_ENTRIES = 100

let _entries = $state<OpenTabInput[]>([])
let _index = $state(-1)
/** Set while back/forward opens a tab, so that open is not recorded. */
let _navigating = false

export function canGoBack(): boolean {
  return _index > 0
}

export function canGoForward(): boolean {
  return _index < _entries.length - 1
}

/** Records a visit to `input` (no-op if it is the current entry). */
export function recordVisit(input: OpenTabInput): void {
  if (_navigating) return
  if (_entries[_index]?.uri === input.uri) return
  const next = _entries.slice(0, _index + 1)
  next.push({ kind: input.kind, uri: input.uri, title: input.title })
  if (next.length > MAX_ENTRIES) next.splice(0, next.length - MAX_ENTRIES)
  _entries = next
  _index = next.length - 1
}

function isReachable(entry: OpenTabInput): boolean {
  if (entry.kind !== NOTE_VIEW_KIND) return true
  const target = parseUri(entry.uri)
  return target?.kind === 'note' && findTreeNode(target.path)?.kind === 'note'
}

function go(delta: 1 | -1): boolean {
  let index = _index + delta
  while (index >= 0 && index < _entries.length) {
    const entry = _entries[index]!
    if (isReachable(entry)) {
      _navigating = true
      try {
        if (openTab(entry) !== null) {
          _index = index
          return true
        }
      } finally {
        _navigating = false
      }
    }
    index += delta
  }
  return false
}

/** Goes back one entry. Resolves to whether anything opened. */
export function goBack(): boolean {
  return go(-1)
}

export function goForward(): boolean {
  return go(1)
}

export function clearHistory(): void {
  _entries = []
  _index = -1
}

/**
 * Starts recording the active tab. History is per vault: a switch clears
 * it. Returns the cleanup.
 */
export function initHistory(): () => void {
  const stopEffect = $effect.root(() => {
    $effect(() => {
      const tab = getActiveTab()
      if (!tab) return
      const input = { kind: tab.kind, uri: tab.uri, title: tab.title }
      untrack(() => recordVisit(input))
    })
  })
  // The first vault of a session keeps what was visited while it reopened.
  const stopVault = onVaultChange((_next, previous) => {
    if (previous) clearHistory()
  })
  return () => {
    stopEffect()
    stopVault()
  }
}

export function __resetHistoryForTests(): void {
  _entries = []
  _index = -1
  _navigating = false
}
