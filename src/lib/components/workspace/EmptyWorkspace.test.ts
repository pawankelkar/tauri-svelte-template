import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { flushSync } from 'svelte'

vi.mock('$lib/stores/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))

import EmptyWorkspace from './EmptyWorkspace.svelte'
import { installFakeBackend, TEST_VAULT_PATH } from '../../../test/fake-backend'
import { resetAllStores, resetVaultStores } from '../../../test/reset-stores'
import { render, type Rendered } from '../../../test/render'
import { defaultAppState } from '$lib/stores/app-state-schema'
import { getActiveTab, initTabs } from '$lib/workspace/tabs.svelte'
import { notePathOfTab } from '$lib/workspace/open-note'
import {
  closeCurrentVault,
  getCurrentVault,
  initVault,
} from '$lib/stores/vault.svelte'
import { initNotes } from '$lib/stores/notes.svelte'
import { isCreateVaultOpen, isQuickOpenOpen } from '$lib/stores/overlays.svelte'
import i18n from '$lib/i18n/config'

let cleanups: (() => void)[] = []
let view: Rendered | null = null

function button(label: string): HTMLButtonElement {
  const found = [...document.body.querySelectorAll('button')].find((b) =>
    b.textContent?.includes(label),
  )
  if (!found) throw new Error(`no button "${label}"`)
  return found
}

beforeEach(async () => {
  resetAllStores()
  resetVaultStores()
  installFakeBackend({ open: true })
  initTabs(defaultAppState())
  cleanups = [await initVault(null), initNotes()]
})

afterEach(() => {
  view?.cleanup()
  view = null
  for (const cleanup of cleanups) cleanup()
})

describe('EmptyWorkspace', () => {
  it('offers a new note and quick open inside a vault', async () => {
    view = render(EmptyWorkspace)
    expect(view.target.textContent).toContain(i18n.t('workspace.noNote.title'))
    button(i18n.t('workspace.noNote.quickOpen')).click()
    expect(isQuickOpenOpen()).toBe(true)
    button(i18n.t('workspace.noNote.newNote')).click()
    await vi.waitFor(() =>
      expect(notePathOfTab(getActiveTab())).toMatch(/\.md$/),
    )
  })

  it('offers to create, open or reopen a vault without one', async () => {
    await closeCurrentVault()
    view = render(EmptyWorkspace)
    flushSync()
    expect(view.target.textContent).toContain(i18n.t('workspace.empty.title'))
    expect(view.target.textContent).toContain(TEST_VAULT_PATH)
    button(i18n.t('workspace.empty.createVault')).click()
    expect(isCreateVaultOpen()).toBe(true)
    button(TEST_VAULT_PATH).click()
    await vi.waitFor(() =>
      expect(getCurrentVault()?.path).toBe(TEST_VAULT_PATH),
    )
  })
})
