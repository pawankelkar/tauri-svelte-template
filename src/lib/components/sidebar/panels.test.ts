import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { flushSync } from 'svelte'

vi.mock('$lib/stores/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

import SearchView from './SearchView.svelte'
import BacklinksPanel from './BacklinksPanel.svelte'
import OutlinePanel from './OutlinePanel.svelte'
import {
  installFakeBackend,
  type FakeBackend,
} from '../../../test/fake-backend'
import { resetAllStores, resetVaultStores } from '../../../test/reset-stores'
import { press, render, typeInto, type Rendered } from '../../../test/render'
import { defaultAppState } from '$lib/stores/app-state-schema'
import { getActiveTab, initTabs } from '$lib/workspace/tabs.svelte'
import { notePathOfTab, openNote } from '$lib/workspace/open-note'
import { initVault } from '$lib/stores/vault.svelte'
import {
  ensureDoc,
  initNotes,
  updateDocContent,
} from '$lib/stores/notes.svelte'
import { getSearchQuery, setSearchQuery } from '$lib/stores/sidebar.svelte'
import {
  registerEditor,
  setCursorLine,
} from '$lib/editor/editor-registry.svelte'
import i18n from '$lib/i18n/config'

let backend: FakeBackend
let cleanups: (() => void)[] = []
let view: Rendered | null = null

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
  vi.useRealTimers()
})

describe('SearchView', () => {
  it('hints until something is typed', () => {
    view = render(SearchView)
    expect(view.target.textContent).toContain(i18n.t('search.hint'))
  })

  it('debounces the query into Rust and lists hits', async () => {
    view = render(SearchView)
    const input = view.target.querySelector<HTMLInputElement>('input')!
    typeInto(input, 'gar')
    typeInto(input, 'garden')
    expect(getSearchQuery()).toBe('garden')
    await vi.waitFor(() =>
      expect(
        view!.target.querySelectorAll('[data-hit]').length,
      ).toBeGreaterThan(0),
    )
    const searches = backend.calls.filter((c) => c.cmd === 'search_fulltext')
    expect(searches.map((c) => c.args.query)).toEqual(['garden'])
  })

  it('opens the first hit on Enter and clears on Escape', async () => {
    setSearchQuery('garden')
    view = render(SearchView)
    await vi.waitFor(() =>
      expect(
        view!.target.querySelectorAll('[data-hit]').length,
      ).toBeGreaterThan(0),
    )
    const input = view.target.querySelector<HTMLInputElement>('input')!
    press(input, 'Enter')
    expect(notePathOfTab(getActiveTab())).toMatch(/\.md$/)
    press(input, 'Escape')
    expect(getSearchQuery()).toBe('')
  })

  it('says when nothing matches', async () => {
    setSearchQuery('zzzqqq-nothing')
    view = render(SearchView)
    await vi.waitFor(() =>
      expect(view!.target.textContent).toContain(
        i18n.t('search.noResults', { query: 'zzzqqq-nothing' }),
      ),
    )
  })
})

describe('BacklinksPanel', () => {
  it('lists notes linking here, grouped by source', async () => {
    view = render(BacklinksPanel, { path: 'Welcome.md' })
    await vi.waitFor(() =>
      expect(view!.target.querySelectorAll('button').length).toBeGreaterThan(0),
    )
    expect(
      backend.calls.find((c) => c.cmd === 'get_backlinks')?.args,
    ).toMatchObject({
      path: 'Welcome.md',
    })
  })

  it('opens the linking note at the link', async () => {
    view = render(BacklinksPanel, { path: 'Welcome.md' })
    await vi.waitFor(() =>
      expect(view!.target.querySelector('button')).not.toBeNull(),
    )
    view.target.querySelector('button')!.click()
    flushSync()
    expect(notePathOfTab(getActiveTab())).not.toBe('Welcome.md')
  })

  it('shows its empty states', async () => {
    view = render(BacklinksPanel, { path: null })
    expect(view.target.textContent).toContain(i18n.t('backlinks.noNote'))
    view.cleanup()
    backend.override('get_backlinks', () => [])
    view = render(BacklinksPanel, { path: 'Ideas.md' })
    await vi.waitFor(() =>
      expect(view!.target.textContent).toContain(i18n.t('backlinks.empty')),
    )
  })
})

describe('OutlinePanel', () => {
  it('asks Rust for the headings of the live buffer', async () => {
    const tabId = openNote('Welcome.md')!
    await ensureDoc('Welcome.md')
    view = render(OutlinePanel, { path: 'Welcome.md', tabId })
    await vi.waitFor(() =>
      expect(view!.target.querySelectorAll('button').length).toBeGreaterThan(0),
    )

    updateDocContent('Welcome.md', '# One\n\ntext\n\n## Two\n')
    await vi.waitFor(() =>
      expect(
        [...view!.target.querySelectorAll('button')].map((b) =>
          b.textContent?.trim(),
        ),
      ).toEqual(['One', 'Two']),
    )
  })

  it('marks the heading the caret is under and jumps on click', async () => {
    const tabId = openNote('Welcome.md')!
    await ensureDoc('Welcome.md')
    updateDocContent('Welcome.md', '# One\n\ntext\n\n## Two\nmore')
    const reveal = vi.fn()
    registerEditor(tabId, {
      focus: vi.fn(),
      reveal,
      toggleBold: vi.fn(),
      toggleItalic: vi.fn(),
      openFind: vi.fn(),
      selectedText: () => '',
    })
    view = render(OutlinePanel, { path: 'Welcome.md', tabId })
    await vi.waitFor(() =>
      expect(view!.target.querySelectorAll('button').length).toBe(2),
    )
    const [one, two] = view.target.querySelectorAll('button')
    setCursorLine(tabId, 5)
    flushSync()
    expect(two!.getAttribute('aria-current')).toBe('location')
    expect(one!.getAttribute('aria-current')).toBeNull()
    one!.click()
    expect(reveal).toHaveBeenCalledWith({ line: 0 })
  })
})
