/**
 * Open note documents: the editor buffer of every note that has a tab.
 *
 * A document outlives its view — switching tabs unmounts the editor, and an
 * unsaved buffer must survive that — so documents are tied to tabs instead:
 * created when a note view first asks for one, dropped when the note's tab
 * closes (see the `note` tab hooks in `initNotes`).
 *
 * Save model
 * - Every edit marks the document dirty and (re)arms an autosave timer
 *   (`AUTOSAVE_DELAY_MS`); `note.save` / mod+s saves at once.
 * - Writes carry the hash of the content we last read or wrote
 *   (`expectedHash`), so Rust refuses to overwrite a file that changed on
 *   disk behind our back. One save per document is in flight at a time.
 *
 * Conflict model
 * - `writeNote` answering `conflict`, or `vault:fs-changed` naming a note
 *   whose buffer is dirty, puts the document in conflict: autosave stops and
 *   the note view shows a banner — keep mine (overwrite, no hash check) or
 *   reload (discard the buffer).
 * - A clean document is reloaded silently on an external change.
 * - A note removed on disk is a `removed` conflict: keep mine recreates it,
 *   reload closes the tab.
 *
 * Renames and trash go through here so open tabs follow the file (or
 * close), and so documents whose links Rust rewrote are re-read — Rust's own
 * writes never come back as `fs-changed`.
 */
import type { FsChange, FsChangedPayload, VaultInfo } from '$lib/tauri-bindings'
import { EVENTS } from '$lib/tauri-bindings'
import * as api from '$lib/vault/api'
import {
  isNotePath,
  isSameOrUnder,
  noteStem,
  remapPath,
} from '$lib/vault/paths'
import { describeError, isCoreErrorKind } from '$lib/core-error'
import {
  closeTab,
  getTabsOfKind,
  retargetTab,
  setTabDirty,
  setTabKindHooks,
  type Tab,
} from '$lib/workspace/tabs.svelte'
import {
  NOTE_VIEW_KIND,
  findNoteTab,
  notePathOfTab,
  noteUri,
  openNote,
} from '$lib/workspace/open-note'
import { noteTitleFromPath } from '$lib/workspace/uri'
import {
  findTreeNode,
  hasVault,
  onVaultChange,
  refreshTree,
} from '$lib/stores/vault.svelte'
import { setUnsavedSource } from '$lib/stores/dirty.svelte'
import { remapTreeState } from '$lib/stores/tree-state.svelte'
import { confirm } from '$lib/stores/confirm.svelte'
import { toast } from '$lib/stores/toast'
import { subscribeEvent } from '$lib/utils/subscribe-event'
import i18n from '$lib/i18n/config'
import { logger } from '$lib/logger'

export const AUTOSAVE_DELAY_MS = 800

export type NoteConflict = 'modified' | 'removed'

export interface NoteDoc {
  path: string
  /** The live buffer. */
  content: string
  /** What is on disk, as far as we know. */
  savedContent: string
  /** Hash of `savedContent`, sent as `expectedHash`; `null` until loaded. */
  savedHash: string | null
  loaded: boolean
  /** Set when the note could not be read at all. */
  loadError: string | null
  dirty: boolean
  conflict: NoteConflict | null
  saving: boolean
  /** The last save failure other than a conflict, for the status line. */
  saveError: string | null
  /** Epoch ms of the last successful save in this session. */
  lastSavedAt: number | null
  /**
   * Bumped whenever `content` is replaced from outside the editor (a
   * reload), so a mounted editor knows to take the new text.
   */
  version: number
}

const UNSAVED_SOURCE = 'notes'

let _docs = $state<Record<string, NoteDoc>>({})
/**
 * Bumped after anything that can change which notes link where: a save,
 * rename, trash or external edit. The backlinks panel re-queries on it.
 */
let _linksVersion = $state(0)
/** Paths whose next save should be skipped because they are being discarded. */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never rendered
const _discarding = new Set<string>()
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never rendered
const _timers = new Map<string, ReturnType<typeof setTimeout>>()
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never rendered
const _inflight = new Map<string, Promise<void>>()
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never rendered
const _loads = new Map<string, Promise<void>>()

// --- Reads --------------------------------------------------------------------

export function getDoc(path: string | null | undefined): NoteDoc | undefined {
  return path ? _docs[path] : undefined
}

export function getLinksVersion(): number {
  return _linksVersion
}

export function hasDirtyNotes(): boolean {
  return Object.values(_docs).some((d) => d.dirty)
}

// --- Bookkeeping ----------------------------------------------------------------

function blankDoc(path: string): NoteDoc {
  return {
    path,
    content: '',
    savedContent: '',
    savedHash: null,
    loaded: false,
    loadError: null,
    dirty: false,
    conflict: null,
    saving: false,
    saveError: null,
    lastSavedAt: null,
    version: 0,
  }
}

/** Mirrors a document's dirtiness onto its tab and the quit gate. */
function syncDirty(path: string): void {
  const doc = _docs[path]
  const tab = findNoteTab(path)
  if (tab) setTabDirty(tab.id, doc?.dirty ?? false)
  setUnsavedSource(UNSAVED_SOURCE, hasDirtyNotes())
}

function clearTimer(path: string): void {
  const timer = _timers.get(path)
  if (timer !== undefined) clearTimeout(timer)
  _timers.delete(path)
}

function dropDoc(path: string): void {
  clearTimer(path)
  delete _docs[path]
  _discarding.delete(path)
  setUnsavedSource(UNSAVED_SOURCE, hasDirtyNotes())
}

/** Takes the text on disk as the new baseline, replacing the buffer. */
function adoptDisk(doc: NoteDoc, content: string, hash: string): void {
  const replaced = doc.content !== content
  doc.content = content
  doc.savedContent = content
  doc.savedHash = hash
  doc.dirty = false
  doc.conflict = null
  doc.saveError = null
  doc.loaded = true
  doc.loadError = null
  if (replaced) doc.version++
  syncDirty(doc.path)
}

// --- Loading --------------------------------------------------------------------

/**
 * The document for `path`, loading it on first use. Resolves once loaded
 * (or failed — see `loadError`).
 */
export function ensureDoc(path: string): Promise<void> {
  const doc = _docs[path]
  if (doc?.loaded) return Promise.resolve()
  const loading = _loads.get(path)
  if (loading) return loading
  if (!doc) _docs[path] = blankDoc(path)
  const promise = loadDoc(path).finally(() => _loads.delete(path))
  _loads.set(path, promise)
  return promise
}

async function loadDoc(path: string): Promise<void> {
  try {
    const note = await api.readNote(path)
    const doc = _docs[path]
    if (!doc) return
    adoptDisk(doc, note.content, note.hash)
  } catch (e) {
    const doc = _docs[path]
    if (!doc) return
    doc.loaded = false
    doc.loadError = describeError(e)
    logger.warn(`Reading ${path} failed`, e)
  }
}

/** Retries a failed load. */
export function retryLoad(path: string): Promise<void> {
  const doc = _docs[path]
  if (doc) doc.loadError = null
  return ensureDoc(path)
}

// --- Editing and saving -----------------------------------------------------------

/** Records an edit from the editor and arms autosave. */
export function updateDocContent(path: string, content: string): void {
  const doc = _docs[path]
  if (!doc || !doc.loaded || doc.content === content) return
  doc.content = content
  doc.dirty = content !== doc.savedContent
  syncDirty(path)
  clearTimer(path)
  if (doc.dirty && !doc.conflict) {
    _timers.set(
      path,
      setTimeout(() => {
        _timers.delete(path)
        void saveDoc(path)
      }, AUTOSAVE_DELAY_MS),
    )
  }
}

/**
 * Saves the document now. No-op when clean, in conflict, or being discarded.
 * Never throws; failures land on the document.
 */
export async function saveDoc(path: string): Promise<void> {
  clearTimer(path)
  const running = _inflight.get(path)
  if (running) {
    await running
    // Edits made while that save ran still need writing.
    return saveDoc(path)
  }
  const doc = _docs[path]
  if (!doc || !doc.loaded || !doc.dirty || doc.conflict) return
  if (_discarding.has(path)) return

  const promise = writeDoc(doc)
  _inflight.set(path, promise)
  try {
    await promise
  } finally {
    _inflight.delete(path)
  }
}

async function writeDoc(doc: NoteDoc): Promise<void> {
  const path = doc.path
  const content = doc.content
  doc.saving = true
  try {
    const result = await api.writeNote(path, content, doc.savedHash)
    const current = _docs[path]
    if (!current) return
    current.savedContent = content
    current.savedHash = result.hash
    current.dirty = current.content !== content
    current.saveError = null
    current.lastSavedAt = Date.now()
    _linksVersion++
    syncDirty(path)
  } catch (e) {
    const current = _docs[path]
    if (!current) return
    if (isCoreErrorKind(e, 'conflict')) {
      current.conflict = (await existsOnDisk(path)) ? 'modified' : 'removed'
    } else {
      current.saveError = describeError(e)
      logger.warn(`Saving ${path} failed`, e)
      toast.error(i18n.t('notes.saveFailed', { name: noteStem(path) }), {
        description: current.saveError,
      })
    }
  } finally {
    const current = _docs[path]
    if (current) current.saving = false
  }
}

async function existsOnDisk(path: string): Promise<boolean> {
  try {
    await api.readNote(path)
    return true
  } catch (e) {
    return !isCoreErrorKind(e, 'notFound')
  }
}

/**
 * Saves every dirty document (pending autosaves included). Used by the quit
 * gate, so that only work that really cannot be saved (a conflict, a failing
 * disk) makes the app ask before quitting.
 */
export async function flushAllNotes(): Promise<void> {
  await Promise.all(Object.keys(_docs).map((path) => saveDoc(path)))
}

// --- Conflict resolution ------------------------------------------------------------

/** Overwrites the file with the buffer, ignoring what changed on disk. */
export async function keepMine(path: string): Promise<void> {
  const doc = _docs[path]
  if (!doc) return
  clearTimer(path)
  const content = doc.content
  const recreating = doc.conflict === 'removed'
  doc.saving = true
  try {
    const result = await api.writeNote(path, content, null)
    const current = _docs[path]
    if (!current) return
    current.savedContent = content
    current.savedHash = result.hash
    current.dirty = current.content !== content
    current.conflict = null
    current.saveError = null
    current.lastSavedAt = Date.now()
    _linksVersion++
    syncDirty(path)
    if (recreating) void refreshTree()
  } catch (e) {
    toast.error(i18n.t('notes.saveFailed', { name: noteStem(path) }), {
      description: describeError(e),
    })
  } finally {
    const current = _docs[path]
    if (current) current.saving = false
  }
}

/**
 * Discards the buffer and takes the file on disk. A note that is gone from
 * disk closes instead.
 */
export async function reloadFromDisk(path: string): Promise<void> {
  const doc = _docs[path]
  if (!doc) return
  clearTimer(path)
  try {
    const note = await api.readNote(path)
    const current = _docs[path]
    if (current) adoptDisk(current, note.content, note.hash)
  } catch (e) {
    if (isCoreErrorKind(e, 'notFound')) {
      await discardAndClose(path)
      return
    }
    toast.error(describeError(e))
  }
}

async function discardAndClose(path: string): Promise<void> {
  _discarding.add(path)
  const tab = findNoteTab(path)
  if (tab) await closeTab(tab.id, { force: true })
  dropDoc(path)
}

// --- External changes -------------------------------------------------------------

async function onExternalChange(change: FsChange): Promise<void> {
  if (change.kind === 'renamed' && change.oldPath) {
    moveDocs(change.oldPath, change.path)
    remapTreeState(change.oldPath, change.path)
    return
  }
  const doc = _docs[change.path]
  if (!doc || !doc.loaded) return
  if (change.kind === 'removed') {
    doc.conflict = 'removed'
    clearTimer(doc.path)
    return
  }
  // created / modified
  let note
  try {
    note = await api.readNote(change.path)
  } catch (e) {
    if (isCoreErrorKind(e, 'notFound')) {
      const current = _docs[change.path]
      if (current) current.conflict = 'removed'
    }
    return
  }
  const current = _docs[change.path]
  if (!current) return
  // Our own write echoed back, or a touch that changed nothing.
  if (note.hash === current.savedHash) {
    if (current.conflict === 'removed') current.conflict = null
    return
  }
  if (current.dirty || current.saving) {
    current.conflict = 'modified'
    clearTimer(current.path)
  } else {
    adoptDisk(current, note.content, note.hash)
  }
}

function onFsChanged(payload: FsChangedPayload): void {
  const touchesNotes = payload.changes.some(
    (c) => isNotePath(c.path) || (c.oldPath !== null && isNotePath(c.oldPath)),
  )
  if (touchesNotes) _linksVersion++
  for (const change of payload.changes) void onExternalChange(change)
}

// --- Rename, move, trash, create ------------------------------------------------------

/**
 * Re-keys every document at or under `from` to its new path and points its
 * tab there. Works for a single note and for a whole folder.
 */
function moveDocs(from: string, to: string): void {
  for (const path of Object.keys(_docs)) {
    if (!isSameOrUnder(path, from)) continue
    const next = remapPath(path, from, to)
    const doc = _docs[path]!
    clearTimer(path)
    delete _docs[path]
    doc.path = next
    _docs[next] = doc
    if (doc.dirty && !doc.conflict) {
      _timers.set(
        next,
        setTimeout(() => {
          _timers.delete(next)
          void saveDoc(next)
        }, AUTOSAVE_DELAY_MS),
      )
    }
  }
  for (const tab of getTabsOfKind(NOTE_VIEW_KIND)) {
    const path = notePathOfTab(tab)
    if (!path || !isSameOrUnder(path, from)) continue
    const next = remapPath(path, from, to)
    retargetTab(tab.id, noteUri(next), noteTitleFromPath(next))
  }
}

/** Re-reads clean open documents after Rust rewrote links in other notes. */
async function reloadCleanDocs(): Promise<void> {
  await Promise.all(
    Object.values(_docs)
      .filter((d) => d.loaded && !d.dirty && !d.conflict)
      .map(async (doc) => {
        try {
          const note = await api.readNote(doc.path)
          const current = _docs[doc.path]
          if (current && !current.dirty && note.hash !== current.savedHash) {
            adoptDisk(current, note.content, note.hash)
          }
        } catch {
          // Gone or unreadable: the next external event or save says so.
        }
      }),
  )
}

/**
 * Renames or moves a note or folder. Unsaved buffers under it are saved
 * first so nothing is written to the old path afterwards. Resolves to the
 * new path, or `null` if nothing was renamed (a toast explains why).
 */
export async function renameEntry(
  from: string,
  to: string,
): Promise<string | null> {
  if (from === to) return from
  const affected = Object.keys(_docs).filter((p) => isSameOrUnder(p, from))
  await Promise.all(affected.map((p) => saveDoc(p)))
  const stuck = affected.find((p) => _docs[p]?.conflict)
  if (stuck) {
    toast.error(i18n.t('notes.renameBlocked', { name: noteStem(stuck) }))
    return null
  }
  try {
    const result = await api.renamePath(from, to)
    moveDocs(from, result.path)
    remapTreeState(from, result.path)
    _linksVersion++
    await refreshTree()
    if (result.updatedFiles > 0) {
      await reloadCleanDocs()
      toast.success(
        i18n.t('notes.linksUpdated', {
          count: result.updatedLinks,
          files: result.updatedFiles,
        }),
      )
    }
    return result.path
  } catch (e) {
    toast.error(i18n.t('notes.renameFailed'), { description: describeError(e) })
    return null
  }
}

/**
 * Moves a note or folder to the vault's trash after asking. Its tabs close
 * without saving (the file is going away). Resolves to whether it happened.
 */
export async function trashEntry(
  path: string,
  options: { confirm?: boolean } = {},
): Promise<boolean> {
  if (options.confirm !== false) {
    const proceed = await confirm({
      titleKey: 'notes.trash.title',
      titleOptions: { name: noteStem(path) },
      descriptionKey: 'notes.trash.description',
      confirmKey: 'notes.trash.confirm',
      cancelKey: 'notes.trash.cancel',
      destructive: true,
    })
    if (!proceed) return false
  }
  try {
    await api.trashPath(path)
  } catch (e) {
    toast.error(i18n.t('notes.trashFailed'), { description: describeError(e) })
    return false
  }
  for (const doc of Object.keys(_docs)) {
    if (isSameOrUnder(doc, path)) await discardAndClose(doc)
  }
  for (const tab of getTabsOfKind(NOTE_VIEW_KIND)) {
    const tabPath = notePathOfTab(tab)
    if (tabPath && isSameOrUnder(tabPath, path)) {
      await closeTab(tab.id, { force: true })
    }
  }
  _linksVersion++
  await refreshTree()
  return true
}

/**
 * Creates a note (in `folder`, or the root) and opens it in a kept tab.
 * Resolves to its path, or `null` on failure.
 */
export async function createAndOpenNote(
  folder: string | null = null,
  title: string | null = null,
): Promise<string | null> {
  try {
    const ref = await api.createNote(folder, title)
    await refreshTree()
    openNote(ref.path)
    return ref.path
  } catch (e) {
    toast.error(i18n.t('notes.createFailed'), { description: describeError(e) })
    return null
  }
}

/**
 * Creates a note from a name as typed in quick open or a `[[link]]`:
 * `Folder/Name` goes in Folder when that folder exists (the root
 * otherwise), and a trailing `.md` is ignored.
 */
export function createNoteFromName(spec: string): Promise<string | null> {
  const name = spec.trim().replace(/\.md$/i, '')
  const slash = name.lastIndexOf('/')
  const folder = slash === -1 ? null : name.slice(0, slash)
  const title = slash === -1 ? name : name.slice(slash + 1)
  const usable =
    folder && findTreeNode(folder)?.kind === 'folder' ? folder : null
  return createAndOpenNote(usable, title || null)
}

// --- Lifecycle ----------------------------------------------------------------------

/** Closes every note tab without prompting; their buffers are dropped. */
async function discardAllNotes(): Promise<void> {
  for (const path of Object.keys(_docs)) _discarding.add(path)
  for (const tab of getTabsOfKind(NOTE_VIEW_KIND)) {
    await closeTab(tab.id, { force: true })
  }
  for (const path of Object.keys(_docs)) dropDoc(path)
}

async function onVaultSwitched(
  _next: VaultInfo | null,
  previous: VaultInfo | null,
): Promise<void> {
  // Tabs restored at startup belong to the vault being reopened; only a
  // real switch (or close) leaves them pointing at the wrong folder.
  if (!previous) return
  // No flush here: the backend already points at the next vault, so a save
  // now would land in the wrong folder. The switch flows flush beforehand
  // (see `confirmLeaveVault` in vault-actions.ts).
  await discardAllNotes()
}

/**
 * Wires the store to tab closes, vault switches and external edits. Call
 * after `initVault()` and `initTabs()`: note tabs restored for a vault that
 * could not be reopened are closed here.
 */
export function initNotes(): () => void {
  const cleanups = [
    setTabKindHooks(NOTE_VIEW_KIND, {
      beforeClose: async (tab: Tab) => {
        const path = notePathOfTab(tab)
        if (path && !_discarding.has(path)) await saveDoc(path)
      },
      closed: (tab: Tab) => {
        const path = notePathOfTab(tab)
        if (path) dropDoc(path)
      },
    }),
    onVaultChange((next, previous) => {
      void onVaultSwitched(next, previous)
    }),
    subscribeEvent<FsChangedPayload>(EVENTS.vaultFsChanged, onFsChanged),
  ]
  if (!hasVault()) void discardAllNotes()
  return () => {
    for (const cleanup of cleanups) cleanup()
  }
}

export function __resetNotesForTests(): void {
  for (const timer of _timers.values()) clearTimeout(timer)
  _timers.clear()
  _inflight.clear()
  _loads.clear()
  _discarding.clear()
  _docs = {}
  _linksVersion = 0
  setUnsavedSource(UNSAVED_SOURCE, false)
}
