/**
 * User-facing vault flows: pick a folder, open, switch, close, forget,
 * reindex — each reporting failure with a toast, so buttons, commands and
 * the menu can just call them.
 */
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import type { DbEncryption } from '$lib/tauri-bindings'
import { describeError, isCoreErrorKind } from '$lib/core-error'
import * as api from '$lib/vault/api'
import {
  closeCurrentVault,
  createVaultAt,
  forgetVault,
  getCurrentVault,
  openRecentVault,
  openVaultAt,
  startReindex,
} from '$lib/stores/vault.svelte'
import { flushAllNotes, hasDirtyNotes } from '$lib/stores/notes.svelte'
import { confirm } from '$lib/stores/confirm.svelte'
import { toast } from '$lib/stores/toast'
import i18n from '$lib/i18n/config'
import { logger } from '$lib/logger'

/**
 * Saves every open note before the backend moves to another vault (a save
 * after the switch would land in the wrong folder). Resolves to `false` when
 * something could not be saved and the user chose to stay.
 */
export async function confirmLeaveVault(): Promise<boolean> {
  if (!getCurrentVault()) return true
  await flushAllNotes()
  if (!hasDirtyNotes()) return true
  return confirm({
    titleKey: 'vault.unsaved.title',
    descriptionKey: 'vault.unsaved.description',
    confirmKey: 'vault.unsaved.discard',
    cancelKey: 'vault.unsaved.cancel',
    destructive: true,
  })
}

/** Asks for a folder and opens it as a vault. Resolves to whether it opened. */
export async function pickAndOpenVault(): Promise<boolean> {
  let picked: string | null
  try {
    const result = await openDialog({
      directory: true,
      multiple: false,
      title: i18n.t('vault.open.dialogTitle'),
    })
    picked = typeof result === 'string' ? result : null
  } catch (e) {
    logger.warn('The folder picker failed', e)
    return false
  }
  if (!picked) return false
  if (!(await confirmLeaveVault())) return false
  try {
    await openVaultAt(picked)
    return true
  } catch (e) {
    toast.error(i18n.t('vault.open.failed'), { description: describeError(e) })
    return false
  }
}

/** Asks for the folder a new vault should be created in. */
export async function pickParentFolder(): Promise<string | null> {
  try {
    const result = await openDialog({
      directory: true,
      multiple: false,
      title: i18n.t('vault.create.parentDialogTitle'),
    })
    return typeof result === 'string' ? result : null
  } catch (e) {
    logger.warn('The folder picker failed', e)
    return null
  }
}

/** Creates and opens a vault. Resolves to an error message, or `null`. */
export async function createVault(
  parentDir: string,
  name: string,
  encryption: DbEncryption,
): Promise<string | null> {
  if (!(await confirmLeaveVault())) return i18n.t('vault.unsaved.stayed')
  try {
    await createVaultAt(parentDir, name, encryption)
    return null
  } catch (e) {
    return describeError(e)
  }
}

export async function switchToVault(id: string): Promise<boolean> {
  if (getCurrentVault()?.id === id) return true
  if (!(await confirmLeaveVault())) return false
  try {
    await openRecentVault(id)
    return true
  } catch (e) {
    const key = isCoreErrorKind(e, 'notFound')
      ? 'vault.open.missing'
      : 'vault.open.failed'
    toast.error(i18n.t(key), { description: describeError(e) })
    return false
  }
}

export async function closeVault(): Promise<void> {
  if (!(await confirmLeaveVault())) return
  try {
    await closeCurrentVault()
  } catch (e) {
    toast.error(i18n.t('vault.close.failed'), { description: describeError(e) })
  }
}

export async function forgetVaultById(id: string): Promise<void> {
  if (getCurrentVault()?.id === id && !(await confirmLeaveVault())) return
  try {
    await forgetVault(id)
  } catch (e) {
    toast.error(i18n.t('vault.forget.failed'), {
      description: describeError(e),
    })
  }
}

export async function reindexVault(): Promise<void> {
  try {
    await startReindex()
    toast.info(i18n.t('vault.reindex.started'))
  } catch (e) {
    toast.error(i18n.t('vault.reindex.failed'), {
      description: describeError(e),
    })
  }
}

/**
 * Takes a git snapshot of the vault. Offers to set backups up when the vault
 * is not a repository yet.
 */
export async function backupNow(): Promise<void> {
  // Snapshot what the user sees, not what the autosave has reached so far.
  await flushAllNotes()
  try {
    const status = await api.backupStatus()
    if (!status.initialized) {
      toast.info(i18n.t('backup.notInitialized'), {
        action: {
          label: i18n.t('backup.setUp'),
          onClick: () => void initBackups(),
        },
      })
      return
    }
    const snapshot = await api.backupNow(null)
    if (!snapshot) {
      toast.info(i18n.t('backup.nothingToDo'))
      return
    }
    toast.success(i18n.t('backup.done'), {
      description: i18n.t('backup.doneDescription', {
        count: snapshot.filesChanged,
      }),
    })
  } catch (e) {
    toast.error(i18n.t('backup.failed'), { description: describeError(e) })
  }
}

/** Turns the vault into a git repository for snapshots. */
export async function initBackups(): Promise<void> {
  try {
    const status = await api.backupInit()
    toast.success(i18n.t('backup.initialized'), {
      description: status.lastSnapshot
        ? undefined
        : i18n.t('backup.initializedDescription'),
    })
  } catch (e) {
    toast.error(i18n.t('backup.initFailed'), { description: describeError(e) })
  }
}
