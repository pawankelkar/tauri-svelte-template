import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('$lib/stores/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}))

import { toast } from '$lib/stores/toast'
import type { Note } from '$lib/tauri-bindings'
import { installFakeBackend, type FakeBackend } from '../../test/fake-backend'
import { resetAllStores, resetVaultStores } from '../../test/reset-stores'
import { defaultAppState } from '$lib/stores/app-state-schema'
import {
  initTabs,
  getActiveTab,
  getTabsOfKind,
} from '$lib/workspace/tabs.svelte'
import {
  NOTE_VIEW_KIND,
  notePathOfTab,
  openNote,
} from '$lib/workspace/open-note'
import { closeCurrentVault, getIndexStatus, initVault } from './vault.svelte'
import { getHasUnsavedChanges } from './dirty.svelte'
import { confirmAccept, getConfirmRequest } from './confirm.svelte'
import {
  AUTOSAVE_DELAY_MS,
  createNoteFromName,
  ensureDoc,
  flushAllNotes,
  getDoc,
  hasDirtyNotes,
  initNotes,
  keepMine,
  reloadFromDisk,
  renameEntry,
  saveDoc,
  trashEntry,
  updateDocContent,
} from './notes.svelte'

const WELCOME = 'Welcome.md'

let backend: FakeBackend
let cleanups: (() => void)[] = []

async function openDoc(path: string) {
  openNote(path)
  await ensureDoc(path)
  return getDoc(path)!
}

function writes(): { path: unknown; expectedHash: unknown }[] {
  return backend.calls
    .filter((c) => c.cmd === 'write_note')
    .map((c) => ({ path: c.args.path, expectedHash: c.args.expectedHash }))
}

beforeEach(async () => {
  vi.clearAllMocks()
  resetAllStores()
  resetVaultStores()
  backend = installFakeBackend({ open: true })
  initTabs(defaultAppState())
  cleanups = [await initVault(null), initNotes()]
})

afterEach(() => {
  for (const cleanup of cleanups) cleanup()
  vi.useRealTimers()
})

describe('loading', () => {
  it('reads a note into a clean document', async () => {
    const doc = await openDoc(WELCOME)
    const disk = backend.call<Note>('read_note', { path: WELCOME })
    expect(doc.loaded).toBe(true)
    expect(doc.content).toBe(disk.content)
    expect(doc.savedHash).toBe(disk.hash)
    expect(doc.dirty).toBe(false)
  })

  it('records a load failure on the document', async () => {
    await ensureDoc('Missing.md')
    expect(getDoc('Missing.md')?.loaded).toBe(false)
    expect(getDoc('Missing.md')?.loadError).toBeTruthy()
  })
})

describe('saving', () => {
  it('autosaves after the delay with the last known hash', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const doc = await openDoc(WELCOME)
    const hash = doc.savedHash
    updateDocContent(WELCOME, `${doc.content}\nmore`)
    expect(doc.dirty).toBe(true)
    expect(hasDirtyNotes()).toBe(true)
    expect(getHasUnsavedChanges()).toBe(true)

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 1)
    expect(writes()).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() => expect(doc.dirty).toBe(false))

    expect(writes()).toEqual([{ path: WELCOME, expectedHash: hash }])
    expect(doc.savedHash).not.toBe(hash)
    expect(getHasUnsavedChanges()).toBe(false)
    expect(backend.call<Note>('read_note', { path: WELCOME }).content).toMatch(
      /more$/,
    )
  })

  it('debounces bursts of edits into one write', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const doc = await openDoc(WELCOME)
    for (const suffix of ['a', 'ab', 'abc']) {
      updateDocContent(WELCOME, `${doc.savedContent}${suffix}`)
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS / 2)
    }
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS)
    await vi.waitFor(() => expect(doc.dirty).toBe(false))
    expect(writes()).toHaveLength(1)
  })

  it('saves at once on saveDoc and skips clean documents', async () => {
    const doc = await openDoc(WELCOME)
    await saveDoc(WELCOME)
    expect(writes()).toEqual([])
    updateDocContent(WELCOME, 'changed')
    await saveDoc(WELCOME)
    expect(writes()).toHaveLength(1)
    expect(doc.dirty).toBe(false)
    expect(doc.lastSavedAt).not.toBeNull()
  })

  it('flushAllNotes saves every dirty document', async () => {
    await openDoc(WELCOME)
    await openDoc('Ideas.md')
    updateDocContent(WELCOME, 'one')
    updateDocContent('Ideas.md', 'two')
    await flushAllNotes()
    expect(
      writes()
        .map((w) => w.path)
        .sort(),
    ).toEqual(['Ideas.md', WELCOME])
    expect(hasDirtyNotes()).toBe(false)
  })

  it('keeps a failed save dirty and says why', async () => {
    const doc = await openDoc(WELCOME)
    backend.override('write_note', () => {
      throw { kind: 'internal', message: 'disk full' }
    })
    updateDocContent(WELCOME, 'changed')
    await saveDoc(WELCOME)
    expect(doc.dirty).toBe(true)
    expect(doc.saveError).toBeTruthy()
    expect(toast.error).toHaveBeenCalled()
  })
})

describe('conflicts', () => {
  it('reloads a clean document silently on an external edit', async () => {
    const doc = await openDoc(WELCOME)
    backend.fake.externalEdit(WELCOME, '# Edited elsewhere\n')
    await vi.waitFor(() => expect(doc.content).toBe('# Edited elsewhere\n'))
    expect(doc.conflict).toBeNull()
    expect(doc.version).toBeGreaterThan(0)
  })

  it('puts a dirty document in conflict instead of overwriting', async () => {
    const doc = await openDoc(WELCOME)
    updateDocContent(WELCOME, 'mine')
    backend.fake.externalEdit(WELCOME, 'theirs')
    await vi.waitFor(() => expect(doc.conflict).toBe('modified'))
    expect(doc.content).toBe('mine')
    // Autosave stops while in conflict.
    await saveDoc(WELCOME)
    expect(writes()).toEqual([])
  })

  it('turns a rejected write into a conflict', async () => {
    const doc = await openDoc(WELCOME)
    updateDocContent(WELCOME, 'mine')
    // Changed on disk without an event reaching us (the watcher lagging).
    backend.override('write_note', () => {
      throw { kind: 'conflict', path: WELCOME }
    })
    await saveDoc(WELCOME)
    expect(doc.conflict).toBe('modified')
  })

  it('keep mine overwrites without a hash check', async () => {
    const doc = await openDoc(WELCOME)
    updateDocContent(WELCOME, 'mine')
    backend.fake.externalEdit(WELCOME, 'theirs')
    await vi.waitFor(() => expect(doc.conflict).toBe('modified'))
    await keepMine(WELCOME)
    expect(doc.conflict).toBeNull()
    expect(doc.dirty).toBe(false)
    expect(writes().at(-1)).toEqual({ path: WELCOME, expectedHash: null })
    expect(backend.call<Note>('read_note', { path: WELCOME }).content).toBe(
      'mine',
    )
  })

  it('reload discards the buffer for what is on disk', async () => {
    const doc = await openDoc(WELCOME)
    updateDocContent(WELCOME, 'mine')
    backend.fake.externalEdit(WELCOME, 'theirs')
    await vi.waitFor(() => expect(doc.conflict).toBe('modified'))
    await reloadFromDisk(WELCOME)
    expect(doc.content).toBe('theirs')
    expect(doc.dirty).toBe(false)
    expect(doc.conflict).toBeNull()
  })

  it('marks a note removed on disk, and restores it on keep mine', async () => {
    const doc = await openDoc(WELCOME)
    backend.fake.externalEdit(WELCOME, null)
    await vi.waitFor(() => expect(doc.conflict).toBe('removed'))
    await keepMine(WELCOME)
    expect(doc.conflict).toBeNull()
    expect(backend.call<Note>('read_note', { path: WELCOME }).content).toBe(
      doc.content,
    )
  })

  it('closes the tab when a removed note is reloaded', async () => {
    const doc = await openDoc(WELCOME)
    backend.fake.externalEdit(WELCOME, null)
    await vi.waitFor(() => expect(doc.conflict).toBe('removed'))
    await reloadFromDisk(WELCOME)
    expect(getDoc(WELCOME)).toBeUndefined()
    expect(getTabsOfKind(NOTE_VIEW_KIND)).toEqual([])
  })
})

describe('rename, trash and create', () => {
  it('saves first, renames, and points the tab at the new path', async () => {
    await openDoc(WELCOME)
    updateDocContent(WELCOME, 'unsaved')
    const next = await renameEntry(WELCOME, 'Hello.md')
    expect(next).toBe('Hello.md')
    expect(writes().map((w) => w.path)).toEqual([WELCOME])
    expect(getDoc(WELCOME)).toBeUndefined()
    expect(getDoc('Hello.md')?.content).toBe('unsaved')
    expect(notePathOfTab(getActiveTab())).toBe('Hello.md')
    expect(getActiveTab()?.title).toBe('Hello')
  })

  it('moves every open note under a renamed folder', async () => {
    const path = 'Projects/Garden Planner.md'
    await openDoc(path)
    await renameEntry('Projects', 'Work')
    expect(getDoc('Work/Garden Planner.md')).toBeDefined()
    expect(notePathOfTab(getActiveTab())).toBe('Work/Garden Planner.md')
  })

  it('reloads clean notes whose links Rust rewrote', async () => {
    // Getting Started links to [[Welcome]].
    const other = await openDoc('Getting Started.md')
    await renameEntry(WELCOME, 'Hello.md')
    expect(other.content).toContain('[[Hello]]')
    expect(toast.success).toHaveBeenCalled()
  })

  it('refuses to rename a note in conflict', async () => {
    const doc = await openDoc(WELCOME)
    updateDocContent(WELCOME, 'mine')
    backend.fake.externalEdit(WELCOME, 'theirs')
    await vi.waitFor(() => expect(doc.conflict).toBe('modified'))
    expect(await renameEntry(WELCOME, 'Hello.md')).toBeNull()
    expect(backend.commandNames()).not.toContain('rename_path')
  })

  it('asks, trashes and closes the tab without saving', async () => {
    await openDoc(WELCOME)
    updateDocContent(WELCOME, 'going away')
    const done = trashEntry(WELCOME)
    await vi.waitFor(() => expect(getConfirmRequest()).not.toBeNull())
    confirmAccept()
    expect(await done).toBe(true)
    expect(writes()).toEqual([])
    expect(getTabsOfKind(NOTE_VIEW_KIND)).toEqual([])
    expect(() => backend.call('read_note', { path: WELCOME })).toThrow()
  })

  it('creates a note in an existing folder and opens it', async () => {
    const path = await createNoteFromName('Projects/Fresh idea.md')
    expect(path).toBe('Projects/Fresh idea.md')
    expect(notePathOfTab(getActiveTab())).toBe(path)
  })

  it('creates at the root when the folder does not exist', async () => {
    const path = await createNoteFromName('Nowhere/Fresh idea')
    expect(path).toBe('Fresh idea.md')
  })

  it('updates the note count once the tree is re-read', async () => {
    const before = getIndexStatus()!.noteCount
    await createNoteFromName('Projects/Counted.md')
    await vi.waitFor(() => expect(getIndexStatus()!.noteCount).toBe(before + 1))
  })
})

describe('vault switches', () => {
  it('drops every document and note tab when the vault closes', async () => {
    await openDoc(WELCOME)
    await closeCurrentVault()
    await vi.waitFor(() => expect(getTabsOfKind(NOTE_VIEW_KIND)).toEqual([]))
    expect(getDoc(WELCOME)).toBeUndefined()
  })
})
