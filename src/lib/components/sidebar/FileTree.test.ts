import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { flushSync } from 'svelte'

vi.mock('$lib/stores/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))
vi.mock('$lib/context-menu', () => ({ showContextMenu: vi.fn() }))

import { showContextMenu } from '$lib/context-menu'
import FileTree from './FileTree.svelte'
import {
  installFakeBackend,
  type FakeBackend,
} from '../../../test/fake-backend'
import { resetAllStores, resetVaultStores } from '../../../test/reset-stores'
import { press, render, settle, type Rendered } from '../../../test/render'
import { defaultAppState } from '$lib/stores/app-state-schema'
import { getActiveTab, initTabs } from '$lib/workspace/tabs.svelte'
import { notePathOfTab, openNote } from '$lib/workspace/open-note'
import { requestTreeRename } from '$lib/workspace/rename-requests.svelte'
import { initVault } from '$lib/stores/vault.svelte'
import { initNotes } from '$lib/stores/notes.svelte'
import { getTreeSelection, isExpanded } from '$lib/stores/tree-state.svelte'
import { getContextKey } from '$lib/commands/context-keys.svelte'
import i18n from '$lib/i18n/config'

let backend: FakeBackend
let cleanups: (() => void)[] = []
let view: Rendered

const row = (path: string) =>
  view.target.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`)
const tree = () => view.target.querySelector<HTMLElement>('[role="tree"]')!
const labels = () =>
  [...view.target.querySelectorAll('[role="treeitem"]')].map((r) =>
    r.textContent?.trim(),
  )

beforeEach(async () => {
  vi.clearAllMocks()
  resetAllStores()
  resetVaultStores()
  backend = installFakeBackend({ open: true })
  initTabs(defaultAppState())
  cleanups = [await initVault(null), initNotes()]
  view = render(FileTree)
})

afterEach(() => {
  view.cleanup()
  for (const cleanup of cleanups) cleanup()
})

describe('FileTree', () => {
  it('lists the vault with notes named without .md', () => {
    expect(labels()).toContain('Welcome')
    expect(labels()).toContain('Projects')
    expect(row('Projects/Garden Planner.md')).toBeNull()
  })

  it('expands folders on click', () => {
    row('Projects')!.click()
    flushSync()
    expect(isExpanded('Projects')).toBe(true)
    expect(row('Projects/Garden Planner.md')).not.toBeNull()
    expect(row('Projects')!.getAttribute('aria-expanded')).toBe('true')
  })

  it('opens a note in a preview tab on click, a kept one on double click', () => {
    row('Ideas.md')!.click()
    flushSync()
    expect(notePathOfTab(getActiveTab())).toBe('Ideas.md')
    expect(getActiveTab()?.preview).toBe(true)
    row('Ideas.md')!.dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true }),
    )
    flushSync()
    expect(getActiveTab()?.preview).toBe(false)
  })

  it('reveals and selects the active note', async () => {
    openNote('Projects/Research/CRDT Reading List.md')
    await settle()
    expect(isExpanded('Projects/Research')).toBe(true)
    expect(
      row('Projects/Research/CRDT Reading List.md')?.getAttribute(
        'aria-current',
      ),
    ).toBe('page')
  })

  it('moves the selection with the keyboard', () => {
    const paths = () =>
      [...view.target.querySelectorAll('[role="treeitem"]')].map((r) =>
        r.getAttribute('data-path'),
      )
    row('Ideas.md')!.click()
    flushSync()
    const at = paths().indexOf('Ideas.md')
    press(tree(), 'ArrowDown')
    expect(getTreeSelection()).toBe(paths()[at + 1])
    press(tree(), 'ArrowUp')
    expect(getTreeSelection()).toBe('Ideas.md')
    press(tree(), 'Home')
    expect(getTreeSelection()).toBe(paths()[0])
    press(tree(), 'End')
    expect(getTreeSelection()).toBe(paths().at(-1))
  })

  it('expands with ArrowRight and opens with Enter', () => {
    row('Projects')!.click() // expands
    row('Projects')!.click() // collapses
    flushSync()
    press(tree(), 'ArrowRight')
    expect(isExpanded('Projects')).toBe(true)
    press(tree(), 'ArrowLeft')
    expect(isExpanded('Projects')).toBe(false)
    row('Ideas.md')!.click()
    flushSync()
    press(tree(), 'Enter')
    expect(getActiveTab()?.preview).toBe(false)
  })

  it('renames in place and validates the name', async () => {
    requestTreeRename('Ideas.md')
    await settle()
    const input =
      view.target.querySelector<HTMLInputElement>('input[data-rename]')!
    expect(input.value).toBe('Ideas')

    input.value = 'bad/name'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    press(input, 'Enter')
    await settle()
    expect(view.target.querySelector('[role="alert"]')?.textContent).toContain(
      i18n.t('vault.names.invalidChars'),
    )

    input.value = 'Better ideas'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    press(input, 'Enter')
    await settle()
    expect(
      backend.calls.find((c) => c.cmd === 'rename_path')?.args,
    ).toMatchObject({
      from: 'Ideas.md',
      to: 'Better ideas.md',
    })
    expect(row('Better ideas.md')).not.toBeNull()
  })

  it('cancels a rename on Escape', async () => {
    requestTreeRename('Ideas.md')
    await settle()
    const input =
      view.target.querySelector<HTMLInputElement>('input[data-rename]')!
    press(input, 'Escape')
    await settle()
    expect(view.target.querySelector('input[data-rename]')).toBeNull()
    expect(backend.commandNames()).not.toContain('rename_path')
  })

  it('opens the context menu for a row', () => {
    row('Ideas.md')!.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    )
    expect(getTreeSelection()).toBe('Ideas.md')
    expect(showContextMenu).toHaveBeenCalledTimes(1)
  })

  it('tracks focus for the fileTreeFocus context key', () => {
    row('Ideas.md')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    expect(getContextKey('fileTreeFocus')).toBe(true)
    row('Ideas.md')!.dispatchEvent(
      new FocusEvent('focusout', { bubbles: true, relatedTarget: null }),
    )
    expect(getContextKey('fileTreeFocus')).toBe(false)
  })
})
