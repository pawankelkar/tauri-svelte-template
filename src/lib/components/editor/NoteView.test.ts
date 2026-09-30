import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { flushSync } from 'svelte'
import { EditorView } from '@codemirror/view'

vi.mock('$lib/stores/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

import NoteView from './NoteView.svelte'
import {
  installFakeBackend,
  type FakeBackend,
} from '../../../test/fake-backend'
import { resetAllStores, resetVaultStores } from '../../../test/reset-stores'
import { press, render, settle, type Rendered } from '../../../test/render'
import { defaultAppState } from '$lib/stores/app-state-schema'
import {
  getActiveTab,
  getGroups,
  getTab,
  initTabs,
} from '$lib/workspace/tabs.svelte'
import { notePathOfTab, openNote } from '$lib/workspace/open-note'
import { requestTitleRename } from '$lib/workspace/rename-requests.svelte'
import { getEditor } from '$lib/editor/editor-registry.svelte'
import { initVault } from '$lib/stores/vault.svelte'
import { getDoc, initNotes, saveDoc } from '$lib/stores/notes.svelte'
import i18n from '$lib/i18n/config'

let backend: FakeBackend
let cleanups: (() => void)[] = []
let view: Rendered | null = null

function show(path: string): string {
  const id = openNote(path)!
  const tab = getTab(id)!
  view = render(NoteView, { tab, groupId: getGroups()[0]!.id })
  return id
}

function editorView(): EditorView {
  const dom = view!.target.querySelector<HTMLElement>('.cm-editor')!
  return EditorView.findFromDOM(dom)!
}

const status = () =>
  view!.target.querySelector('[data-testid="note-status"]')?.textContent?.trim()

function buttonNamed(label: string) {
  return [...view!.target.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === label,
  )!
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
  view?.cleanup()
  view = null
  for (const cleanup of cleanups) cleanup()
})

describe('NoteView', () => {
  it('loads the note into the editor with its breadcrumb', async () => {
    const id = show('Projects/Garden Planner.md')
    await vi.waitFor(() =>
      expect(view!.target.querySelector('.cm-editor')).not.toBeNull(),
    )
    const disk = backend.call<{ content: string }>('read_note', {
      path: 'Projects/Garden Planner.md',
    })
    expect(editorView().state.doc.toString()).toBe(disk.content)
    expect(view!.target.textContent).toContain('Projects')
    expect(view!.target.textContent).toContain('Garden Planner')
    expect(status()).toBe(i18n.t('editor.status.saved'))
    expect(getEditor(id)).toBeDefined()
  })

  it('marks edits unsaved, then saved', async () => {
    show('Welcome.md')
    await vi.waitFor(() =>
      expect(view!.target.querySelector('.cm-editor')).not.toBeNull(),
    )
    const ev = editorView()
    ev.dispatch({ changes: { from: 0, insert: 'Hello ' } })
    flushSync()
    expect(getDoc('Welcome.md')?.dirty).toBe(true)
    expect(status()).toBe(i18n.t('editor.status.unsaved'))
    expect(getActiveTab()?.dirty).toBe(true)
    await saveDoc('Welcome.md')
    flushSync()
    expect(status()).toBe(i18n.t('editor.status.saved'))
  })

  it('takes a silent reload into the editor', async () => {
    show('Welcome.md')
    await vi.waitFor(() =>
      expect(view!.target.querySelector('.cm-editor')).not.toBeNull(),
    )
    backend.fake.externalEdit('Welcome.md', '# From elsewhere\n')
    await vi.waitFor(() =>
      expect(editorView().state.doc.toString()).toBe('# From elsewhere\n'),
    )
  })

  it('shows the conflict bar and keeps mine', async () => {
    show('Welcome.md')
    await vi.waitFor(() =>
      expect(view!.target.querySelector('.cm-editor')).not.toBeNull(),
    )
    editorView().dispatch({ changes: { from: 0, insert: 'Mine ' } })
    flushSync()
    backend.fake.externalEdit('Welcome.md', 'Theirs')
    await vi.waitFor(() =>
      expect(
        view!.target.querySelector('[role="alert"]')?.textContent,
      ).toContain(i18n.t('editor.conflict.modified')),
    )
    buttonNamed(i18n.t('editor.conflict.keepMine')).click()
    await vi.waitFor(() =>
      expect(view!.target.querySelector('[role="alert"]')).toBeNull(),
    )
    expect(
      backend.call<{ content: string }>('read_note', { path: 'Welcome.md' })
        .content,
    ).toMatch(/^Mine /)
  })

  it('reloads from disk from the conflict bar', async () => {
    show('Welcome.md')
    await vi.waitFor(() =>
      expect(view!.target.querySelector('.cm-editor')).not.toBeNull(),
    )
    editorView().dispatch({ changes: { from: 0, insert: 'Mine ' } })
    flushSync()
    backend.fake.externalEdit('Welcome.md', 'Theirs')
    await vi.waitFor(() =>
      expect(view!.target.querySelector('[role="alert"]')).not.toBeNull(),
    )
    buttonNamed(i18n.t('editor.conflict.reload')).click()
    await vi.waitFor(() =>
      expect(editorView().state.doc.toString()).toBe('Theirs'),
    )
  })

  it('renames from the title', async () => {
    const id = show('Ideas.md')
    await vi.waitFor(() =>
      expect(view!.target.querySelector('.cm-editor')).not.toBeNull(),
    )
    requestTitleRename(id)
    await settle()
    const input = view!.target.querySelector<HTMLInputElement>(
      `input[aria-label="${i18n.t('editor.renameTitle')}"]`,
    )!
    expect(input.value).toBe('Ideas')
    input.value = 'Big ideas'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    press(input, 'Enter')
    await vi.waitFor(() =>
      expect(notePathOfTab(getTab(id))).toBe('Big ideas.md'),
    )
  })

  it('offers a retry when the note cannot be read', async () => {
    show('Nope.md')
    await vi.waitFor(() =>
      expect(view!.target.textContent).toContain(i18n.t('editor.loadFailed')),
    )
    expect(buttonNamed(i18n.t('editor.retry'))).toBeDefined()
  })
})
