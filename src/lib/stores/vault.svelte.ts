/**
 * The open vault, the vault registry, the file tree and index status.
 *
 * Rust is the source of truth for all of it; this store mirrors it for the
 * UI and re-reads on the backend's events:
 *
 * - `vault:current-changed` — another vault opened (or none): reload the
 *   tree and the recent list, mirror `lastVaultId` into app state.
 * - `vault:fs-changed` — an edit made outside the app: reload the tree.
 *   (The notes store handles open documents.)
 * - `index:status` — reindex progress.
 *
 * Our own mutations (create, rename, trash) do not produce `fs-changed` —
 * the watcher ignores the app's own writes — so their callers refresh the
 * tree themselves via `refreshTree()`.
 */
import type {
  DbEncryption,
  FsChangedPayload,
  IndexStatus,
  TreeNode,
  VaultInfo,
} from '$lib/tauri-bindings'
import { EVENTS } from '$lib/tauri-bindings'
import * as api from '$lib/vault/api'
import { setAppStateField } from '$lib/stores/app-state.svelte'
import { setContextKey } from '$lib/commands/context-keys.svelte'
import { subscribeEvent } from '$lib/utils/subscribe-event'
import { logger } from '$lib/logger'

let _current = $state<VaultInfo | null>(null)
let _recent = $state<VaultInfo[]>([])
let _tree = $state<TreeNode[]>([])
/** Bumped whenever the tree is re-read, so caches keyed on it can drop. */
let _treeVersion = $state(0)
let _indexStatus = $state<IndexStatus | null>(null)
let _ready = $state(false)

/** Runs whenever the open vault changes identity (switch or close). */
type VaultChangeListener = (
  next: VaultInfo | null,
  previous: VaultInfo | null,
) => void
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never rendered
const _changeListeners = new Set<VaultChangeListener>()

// --- Reads --------------------------------------------------------------------

export function getCurrentVault(): VaultInfo | null {
  return _current
}

export function hasVault(): boolean {
  return _current !== null
}

/** Registered vaults, most recently opened first. */
export function getRecentVaults(): VaultInfo[] {
  return _recent
}

export function getTree(): TreeNode[] {
  return _tree
}

export function getTreeVersion(): number {
  return _treeVersion
}

export function getIndexStatus(): IndexStatus | null {
  return _indexStatus
}

/** Whether the startup reopen has finished (successfully or not). */
export function isVaultReady(): boolean {
  return _ready
}

/** Finds a node anywhere in the tree. */
export function findTreeNode(
  path: string,
  nodes: TreeNode[] = _tree,
): TreeNode | undefined {
  for (const node of nodes) {
    if (node.path === path) return node
    if (node.kind === 'folder' && path.startsWith(`${node.path}/`)) {
      return findTreeNode(path, node.children)
    }
  }
  return undefined
}

export function onVaultChange(listener: VaultChangeListener): () => void {
  _changeListeners.add(listener)
  return () => _changeListeners.delete(listener)
}

// --- Internal -----------------------------------------------------------------

function applyCurrent(next: VaultInfo | null): void {
  const previous = _current
  _current = next
  setContextKey('vaultOpen', next !== null)
  if (previous?.id === next?.id) return
  setAppStateField('lastVaultId', next?.id ?? null)
  _tree = []
  _treeVersion++
  _indexStatus = null
  for (const listener of _changeListeners) {
    try {
      listener(next, previous)
    } catch (e) {
      logger.warn('A vault change listener failed', e)
    }
  }
  if (next) {
    void refreshTree()
    void refreshIndexStatus()
  }
  void refreshRecentVaults()
}

export async function refreshTree(): Promise<void> {
  if (!_current) return
  const id = _current.id
  try {
    const tree = await api.listTree()
    // A switch while the read was in flight makes this tree stale.
    if (_current?.id !== id) return
    _tree = tree
    _treeVersion++
    // Notes came or went; the status bar's count is Rust's, so ask again
    // rather than wait for the next `index:status`.
    void refreshIndexStatus()
  } catch (e) {
    logger.warn('Reading the vault tree failed', e)
  }
}

export async function refreshRecentVaults(): Promise<void> {
  try {
    _recent = await api.listVaults()
  } catch (e) {
    logger.warn('Listing vaults failed', e)
  }
}

async function refreshIndexStatus(): Promise<void> {
  try {
    _indexStatus = await api.indexStatus()
  } catch (e) {
    logger.warn('Reading index status failed', e)
  }
}

// Tree reloads for bursts of external changes are coalesced.
const FS_REFRESH_DEBOUNCE_MS = 150
let _fsTimer: ReturnType<typeof setTimeout> | undefined

function onFsChanged(): void {
  clearTimeout(_fsTimer)
  _fsTimer = setTimeout(() => void refreshTree(), FS_REFRESH_DEBOUNCE_MS)
}

// --- Flows --------------------------------------------------------------------

/** Opens (and registers) the folder at `path`. Throws a CoreError. */
export async function openVaultAt(path: string): Promise<VaultInfo> {
  const info = await api.openVault(path)
  applyCurrent(info)
  return info
}

/** Creates `parentDir/name` as a new vault and opens it. Throws a CoreError. */
export async function createVaultAt(
  parentDir: string,
  name: string,
  encryption: DbEncryption,
): Promise<VaultInfo> {
  const info = await api.createVault(parentDir, name, encryption)
  applyCurrent(info)
  return info
}

/** Reopens a registered vault. Throws a CoreError (`notFound` if it is gone). */
export async function openRecentVault(id: string): Promise<VaultInfo> {
  const info = await api.openVaultById(id)
  applyCurrent(info)
  return info
}

export async function closeCurrentVault(): Promise<void> {
  await api.closeVault()
  applyCurrent(null)
}

/** Removes a vault from the registry. Never deletes files. */
export async function forgetVault(id: string): Promise<void> {
  await api.forgetVault(id)
  if (_current?.id === id) applyCurrent(null)
  else await refreshRecentVaults()
}

export async function startReindex(): Promise<void> {
  await api.reindex()
}

/**
 * Subscribes to the vault events and reopens the last vault. A vault that
 * can no longer be opened (moved, deleted, forgotten) is dropped from
 * `lastVaultId` so the next launch does not try again.
 */
export async function initVault(
  lastVaultId: string | null,
): Promise<() => void> {
  const cleanups = [
    subscribeEvent<VaultInfo | null>(EVENTS.vaultCurrentChanged, (info) => {
      applyCurrent(info)
    }),
    subscribeEvent<FsChangedPayload>(EVENTS.vaultFsChanged, onFsChanged),
    subscribeEvent<IndexStatus>(EVENTS.indexStatus, (status) => {
      _indexStatus = status
    }),
  ]

  try {
    // Already open on the Rust side (a webview reload): adopt it.
    const current = await api.currentVault()
    if (current) {
      applyCurrent(current)
    } else if (lastVaultId) {
      try {
        applyCurrent(await api.openVaultById(lastVaultId))
      } catch (e) {
        logger.warn('Reopening the last vault failed', e)
        setAppStateField('lastVaultId', null)
      }
    }
  } catch (e) {
    logger.warn('Reading the current vault failed', e)
  }
  await refreshRecentVaults()
  _ready = true

  return () => {
    for (const cleanup of cleanups) cleanup()
    clearTimeout(_fsTimer)
  }
}

export function __resetVaultForTests(): void {
  _current = null
  _recent = []
  _tree = []
  _treeVersion = 0
  _indexStatus = null
  _ready = false
  _changeListeners.clear()
  clearTimeout(_fsTimer)
}
