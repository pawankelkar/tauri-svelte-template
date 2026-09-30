import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('$lib/stores/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))

import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { toast } from '$lib/stores/toast'
import i18n from '$lib/i18n/config'
import { installFakeBackend, type FakeBackend } from '../../test/fake-backend'
import { resetAllStores, resetVaultStores } from '../../test/reset-stores'
import { defaultAppState } from '$lib/stores/app-state-schema'
import { initTabs } from '$lib/workspace/tabs.svelte'
import { openNote } from '$lib/workspace/open-note'
import {
  getCurrentVault,
  getRecentVaults,
  initVault,
} from '$lib/stores/vault.svelte'
import {
  ensureDoc,
  getDoc,
  initNotes,
  updateDocContent,
} from '$lib/stores/notes.svelte'
import {
  confirmAccept,
  confirmCancel,
  getConfirmRequest,
} from '$lib/stores/confirm.svelte'
import {
  backupNow,
  closeVault,
  confirmLeaveVault,
  createVault,
  initBackups,
  pickAndOpenVault,
  switchToVault,
} from './vault-actions'

let backend: FakeBackend
let cleanups: (() => void)[] = []

async function dirtyWelcome() {
  openNote('Welcome.md')
  await ensureDoc('Welcome.md')
  updateDocContent('Welcome.md', 'unsaved words')
}

function failWrites() {
  backend.override('write_note', () => {
    throw { kind: 'internal', message: 'disk full' }
  })
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
})

describe('leaving a vault', () => {
  it('saves open notes into the vault being left', async () => {
    await dirtyWelcome()
    expect(await confirmLeaveVault()).toBe(true)
    expect(
      backend.call<{ content: string }>('read_note', { path: 'Welcome.md' })
        .content,
    ).toBe('unsaved words')
    expect(getConfirmRequest()).toBeNull()
  })

  it('asks when something cannot be saved, and stays on cancel', async () => {
    await dirtyWelcome()
    failWrites()
    const leaving = closeVault()
    await vi.waitFor(() => expect(getConfirmRequest()).not.toBeNull())
    confirmCancel()
    await leaving
    expect(getCurrentVault()).not.toBeNull()
    expect(getDoc('Welcome.md')?.dirty).toBe(true)
  })

  it('discards and leaves on confirm', async () => {
    await dirtyWelcome()
    failWrites()
    const leaving = closeVault()
    await vi.waitFor(() => expect(getConfirmRequest()).not.toBeNull())
    confirmAccept()
    await leaving
    expect(getCurrentVault()).toBeNull()
    await vi.waitFor(() => expect(getDoc('Welcome.md')).toBeUndefined())
  })

  it('reports staying as the create error', async () => {
    await dirtyWelcome()
    failWrites()
    const creating = createVault('/tmp', 'Other', 'none')
    await vi.waitFor(() => expect(getConfirmRequest()).not.toBeNull())
    confirmCancel()
    expect(await creating).toBeTruthy()
    expect(getCurrentVault()?.path).toBe('/Users/me/Notes')
  })
})

describe('vault flows', () => {
  it('opens the picked folder', async () => {
    vi.mocked(openDialog).mockResolvedValue('/Users/me/Other')
    expect(await pickAndOpenVault()).toBe(true)
    expect(getCurrentVault()?.path).toBe('/Users/me/Other')
  })

  it('does nothing when the picker is cancelled', async () => {
    vi.mocked(openDialog).mockResolvedValue(null)
    expect(await pickAndOpenVault()).toBe(false)
    expect(getCurrentVault()?.path).toBe('/Users/me/Notes')
  })

  it('switches between recent vaults', async () => {
    const first = getCurrentVault()!
    vi.mocked(openDialog).mockResolvedValue('/Users/me/Other')
    await pickAndOpenVault()
    expect(getRecentVaults().map((v) => v.id)).toContain(first.id)
    expect(await switchToVault(first.id)).toBe(true)
    expect(getCurrentVault()?.id).toBe(first.id)
  })

  it('explains a vault that is gone', async () => {
    expect(await switchToVault('missing')).toBe(false)
    expect(toast.error).toHaveBeenCalledWith(
      i18n.t('vault.open.missing'),
      expect.anything(),
    )
  })
})

describe('backups', () => {
  it('says when there is nothing new to snapshot', async () => {
    // The sample vault has edits since its seeded history; commit them.
    backend.call('backup_now', { message: null })
    await backupNow()
    expect(toast.info).toHaveBeenCalledWith(i18n.t('backup.nothingToDo'))
  })

  it('snapshots after saving what is open', async () => {
    backend.call('backup_now', { message: null })
    await dirtyWelcome()
    await backupNow()
    expect(backend.commandNames().indexOf('write_note')).toBeLessThan(
      backend.commandNames().indexOf('backup_now'),
    )
    expect(toast.success).toHaveBeenCalledWith(i18n.t('backup.done'), {
      description: i18n.t('backup.doneDescription', { count: 1 }),
    })
  })

  it('offers to set backups up for a plain folder', async () => {
    vi.mocked(openDialog).mockResolvedValue('/Users/me/Other')
    await pickAndOpenVault()
    backend.override('backup_status', () => ({
      initialized: false,
      remote: null,
      ahead: 0,
      lastSnapshot: null,
    }))
    await backupNow()
    expect(backend.commandNames()).not.toContain('backup_now')
    const [, options] = vi.mocked(toast.info).mock.calls[0]!
    expect(options?.action).toBeDefined()
  })

  it('initialises backups', async () => {
    await initBackups()
    expect(backend.commandNames()).toContain('backup_init')
    expect(toast.success).toHaveBeenCalled()
  })
})
