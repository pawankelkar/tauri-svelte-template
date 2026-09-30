/**
 * File tree view state: which folders are expanded (remembered per vault in
 * `localStorage`, since it is pure presentation) and which row is selected.
 */
import { SvelteSet } from 'svelte/reactivity'
import type { VaultInfo } from '$lib/tauri-bindings'
import { isSameOrUnder, parentOf, remapPath } from '$lib/vault/paths'
import { onVaultChange } from './vault.svelte'
import { logger } from '$lib/logger'

const STORAGE_PREFIX = 'ostralith.tree.expanded.'
const MAX_REMEMBERED = 2000

const _expanded = new SvelteSet<string>()
let _selected = $state<string | null>(null)
let _vaultId: string | null = null

function storageKey(id: string): string {
  return STORAGE_PREFIX + id
}

function load(id: string | null): void {
  _expanded.clear()
  _selected = null
  _vaultId = id
  if (!id) return
  try {
    const raw = localStorage.getItem(storageKey(id))
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (Array.isArray(parsed)) {
      for (const p of parsed) if (typeof p === 'string') _expanded.add(p)
    }
  } catch (e) {
    logger.warn('Reading the tree state failed', e)
  }
}

function save(): void {
  if (!_vaultId) return
  try {
    localStorage.setItem(
      storageKey(_vaultId),
      JSON.stringify([..._expanded].slice(0, MAX_REMEMBERED)),
    )
  } catch (e) {
    logger.warn('Saving the tree state failed', e)
  }
}

export function isExpanded(path: string): boolean {
  return _expanded.has(path)
}

export function setExpanded(path: string, expanded: boolean): void {
  if (expanded === _expanded.has(path)) return
  if (expanded) _expanded.add(path)
  else _expanded.delete(path)
  save()
}

export function toggleExpanded(path: string): void {
  setExpanded(path, !_expanded.has(path))
}

/** Expands every folder above `path`, so its row is visible. */
export function expandAncestors(path: string): void {
  let changed = false
  for (let p = parentOf(path); p; p = parentOf(p)) {
    if (!_expanded.has(p)) {
      _expanded.add(p)
      changed = true
    }
  }
  if (changed) save()
}

export function getTreeSelection(): string | null {
  return _selected
}

export function setTreeSelection(path: string | null): void {
  _selected = path
}

/** Keeps expand state and the selection on a renamed folder or note. */
export function remapTreeState(from: string, to: string): void {
  const moved = [..._expanded].filter((p) => isSameOrUnder(p, from))
  for (const p of moved) {
    _expanded.delete(p)
    _expanded.add(remapPath(p, from, to))
  }
  if (_selected && isSameOrUnder(_selected, from)) {
    _selected = remapPath(_selected, from, to)
  }
  if (moved.length) save()
}

/** Loads the expand state whenever a vault opens. */
export function initTreeState(): () => void {
  return onVaultChange((next: VaultInfo | null) => load(next?.id ?? null))
}

export function __resetTreeStateForTests(): void {
  _expanded.clear()
  _selected = null
  _vaultId = null
}
