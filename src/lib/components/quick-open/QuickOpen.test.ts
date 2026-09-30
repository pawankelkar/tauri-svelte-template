import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { flushSync } from 'svelte'

vi.mock('$lib/stores/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

import QuickOpen from './QuickOpen.svelte'
import {
  installFakeBackend,
  type FakeBackend,
} from '../../../test/fake-backend'
import { resetAllStores, resetVaultStores } from '../../../test/reset-stores'
import { render, settle, typeInto, type Rendered } from '../../../test/render'
import { defaultAppState } from '$lib/stores/app-state-schema'
import { getActiveTab, initTabs } from '$lib/workspace/tabs.svelte'
import { notePathOfTab } from '$lib/workspace/open-note'
import { initVault } from '$lib/stores/vault.svelte'
import { initNotes } from '$lib/stores/notes.svelte'
import { isQuickOpenOpen, setQuickOpenOpen } from '$lib/stores/overlays.svelte'
import i18n from '$lib/i18n/config'

let backend: FakeBackend
let cleanups: (() => void)[] = []
let view: Rendered

const items = () => [
  ...document.body.querySelectorAll<HTMLElement>('[data-command-item]'),
]
const input = () =>
  document.body.querySelector<HTMLInputElement>('[data-command-input]')!

async function openWith(query: string) {
  setQuickOpenOpen(true)
  flushSync()
  await settle()
  typeInto(input(), query)
  await vi.waitFor(() =>
    expect(
      backend.calls.some(
        (c) => c.cmd === 'quick_open' && c.args.query === query,
      ),
    ).toBe(true),
  )
  await settle()
}

function select(item: HTMLElement) {
  item.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  item.click()
  flushSync()
}

beforeEach(async () => {
  vi.clearAllMocks()
  resetAllStores()
  resetVaultStores()
  backend = installFakeBackend({ open: true })
  initTabs(defaultAppState())
  cleanups = [await initVault(null), initNotes()]
  view = render(QuickOpen)
})

afterEach(() => {
  view.cleanup()
  for (const cleanup of cleanups) cleanup()
})

describe('QuickOpen', () => {
  it('lists recent notes when opened with no query', async () => {
    setQuickOpenOpen(true)
    flushSync()
    await vi.waitFor(() => expect(items().length).toBeGreaterThan(0))
    expect(document.body.textContent).toContain(i18n.t('quickOpen.recent'))
  })

  it('opens the chosen match and closes', async () => {
    await openWith('garden')
    const match = items().find((i) => i.textContent?.includes('Garden'))!
    select(match)
    expect(isQuickOpenOpen()).toBe(false)
    expect(notePathOfTab(getActiveTab())).toBe('Projects/Garden Planner.md')
  })

  it('offers to create a note that does not exist', async () => {
    await openWith('Brand new thought')
    const create = items().find((i) =>
      i.textContent?.includes(
        i18n.t('quickOpen.create', { name: 'Brand new thought' }),
      ),
    )
    expect(create).toBeDefined()
    select(create!)
    await vi.waitFor(() =>
      expect(notePathOfTab(getActiveTab())).toBe('Brand new thought.md'),
    )
  })

  it('does not offer to create an existing note', async () => {
    await openWith('Ideas')
    expect(
      items().some((i) =>
        i.textContent?.includes(i18n.t('quickOpen.create', { name: 'Ideas' })),
      ),
    ).toBe(false)
  })
})
