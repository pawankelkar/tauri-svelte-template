import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('$lib/stores/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

import { installFakeBackend, type FakeBackend } from '../../test/fake-backend'
import { resetAllStores, resetVaultStores } from '../../test/reset-stores'
import { defaultAppState } from '$lib/stores/app-state-schema'
import { getActiveTab, initTabs } from '$lib/workspace/tabs.svelte'
import { notePathOfTab } from '$lib/workspace/open-note'
import { initVault } from '$lib/stores/vault.svelte'
import { initNotes } from '$lib/stores/notes.svelte'
import {
  cachedLink,
  followWikiLink,
  resolveLinkCached,
  syncLinkCache,
} from './link-cache'

let backend: FakeBackend
let cleanups: (() => void)[] = []

const resolves = () =>
  backend.commandNames().filter((c) => c === 'resolve_link').length

beforeEach(async () => {
  resetAllStores()
  resetVaultStores()
  backend = installFakeBackend({ open: true })
  initTabs(defaultAppState())
  cleanups = [await initVault(null), initNotes()]
})

afterEach(() => {
  for (const cleanup of cleanups) cleanup()
})

describe('link cache', () => {
  it('asks Rust once per link until the tree changes', async () => {
    syncLinkCache(1)
    const [a, b] = await Promise.all([
      resolveLinkCached('Welcome.md', 'Ideas'),
      resolveLinkCached('Welcome.md', 'Ideas'),
    ])
    expect(a).toEqual(b)
    expect(a?.exists).toBe(true)
    expect(cachedLink('Welcome.md', 'Ideas')).toEqual(a)
    await resolveLinkCached('Welcome.md', 'Ideas')
    expect(resolves()).toBe(1)

    expect(syncLinkCache(1)).toBe(false)
    expect(syncLinkCache(2)).toBe(true)
    expect(cachedLink('Welcome.md', 'Ideas')).toBeUndefined()
  })

  it('opens an existing note', async () => {
    await followWikiLink('Welcome.md', 'Ideas|my ideas')
    expect(notePathOfTab(getActiveTab())).toBe('Ideas.md')
  })

  it('creates a missing note from its link', async () => {
    await followWikiLink('Welcome.md', 'Brand new')
    expect(notePathOfTab(getActiveTab())).toBe('Brand new.md')
    expect(backend.commandNames()).toContain('create_note')
  })

  it('returns null when Rust cannot answer', async () => {
    backend.override('resolve_link', () => {
      throw { kind: 'internal', message: 'db locked' }
    })
    expect(await resolveLinkCached('Welcome.md', 'X')).toBeNull()
  })
})
