import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { flushSync } from 'svelte'

vi.mock('$lib/stores/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

import { installFakeBackend, TEST_VAULT_PATH } from '../../test/fake-backend'
import { resetVaultStores } from '../../test/reset-stores'
import { defaultAppState } from '$lib/stores/app-state-schema'
import {
  closeCurrentVault,
  initVault,
  openVaultAt,
  refreshTree,
} from '$lib/stores/vault.svelte'
import { closeTab, getActiveTab, initTabs } from './tabs.svelte'
import { findNoteTab, notePathOfTab, openNote } from './open-note'
import {
  canGoBack,
  canGoForward,
  goBack,
  goForward,
  initHistory,
  recordVisit,
} from './history.svelte'

let backend: ReturnType<typeof installFakeBackend>
let cleanups: (() => void)[] = []

function visit(path: string) {
  openNote(path, { preview: false })
  flushSync()
}

const activePath = () => notePathOfTab(getActiveTab())

beforeEach(async () => {
  resetVaultStores()
  backend = installFakeBackend({ open: true })
  initTabs(defaultAppState())
  cleanups = [await initVault(null), initHistory()]
})

afterEach(() => {
  for (const cleanup of cleanups) cleanup()
})

describe('history', () => {
  it('goes back and forward through visited tabs', () => {
    visit('Welcome.md')
    visit('Ideas.md')
    visit('Getting Started.md')
    expect(canGoBack()).toBe(true)
    expect(canGoForward()).toBe(false)

    expect(goBack()).toBe(true)
    flushSync()
    expect(activePath()).toBe('Ideas.md')
    expect(goBack()).toBe(true)
    flushSync()
    expect(activePath()).toBe('Welcome.md')
    expect(canGoBack()).toBe(false)
    expect(goForward()).toBe(true)
    flushSync()
    expect(activePath()).toBe('Ideas.md')
  })

  it('drops forward entries on a new visit', () => {
    visit('Welcome.md')
    visit('Ideas.md')
    goBack()
    flushSync()
    visit('Getting Started.md')
    expect(canGoForward()).toBe(false)
  })

  it('reopens entries whose tab was closed', async () => {
    visit('Welcome.md')
    visit('Ideas.md')
    await closeTab(findNoteTab('Welcome.md')!.id, { force: true })
    flushSync()
    expect(findNoteTab('Welcome.md')).toBeUndefined()
    expect(goBack()).toBe(true)
    flushSync()
    expect(activePath()).toBe('Welcome.md')
  })

  it('skips notes that no longer exist', async () => {
    visit('Welcome.md')
    visit('Ideas.md')
    visit('Getting Started.md')
    backend.call('trash_path', { path: 'Ideas.md' })
    await refreshTree()
    goBack()
    flushSync()
    expect(activePath()).toBe('Welcome.md')
  })

  it('does not record the same entry twice in a row', () => {
    recordVisit({ kind: 'note', uri: 'ostralith://note/a.md', title: 'a' })
    recordVisit({ kind: 'note', uri: 'ostralith://note/a.md', title: 'a' })
    expect(canGoBack()).toBe(false)
  })

  it('is cleared by a vault switch', async () => {
    visit('Welcome.md')
    visit('Ideas.md')
    await closeCurrentVault()
    await openVaultAt(TEST_VAULT_PATH)
    expect(canGoBack()).toBe(false)
  })
})
