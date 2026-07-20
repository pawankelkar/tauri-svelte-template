import { open } from '@tauri-apps/plugin-dialog'
import { toast } from '$lib/stores/toast'
import { t } from '$lib/i18n/t.svelte'
import { logger } from '$lib/logger'
import { registerCommands, type AppCommand } from './registry.svelte'

export const DEMO_OPEN_FILE_DIALOG = 'demo-open-file-dialog'

/**
 * Demo for tauri-plugin-dialog — the native file picker.
 *
 * Note this is the OS file dialog. In-app confirmations use the promise-based
 * `confirm()` in $lib/stores/confirm.svelte instead.
 */
async function openFileDialog(): Promise<void> {
  try {
    const path = await open({ multiple: false, directory: false })
    if (path === null) {
      toast.message(t('demo.fileDialogCancelled'))
      return
    }
    toast.success(t('demo.fileDialogPicked'), { description: String(path) })
  } catch (e) {
    logger.error('File dialog failed', e)
    toast.error(t('demo.fileDialogFailed'))
  }
}

const dialogCommands: AppCommand[] = [
  {
    id: DEMO_OPEN_FILE_DIALOG,
    labelKey: 'commands.demoOpenFileDialog',
    category: 'commands.category.demo',
    run: openFileDialog,
  },
]

export function registerDialogCommands(): void {
  registerCommands(dialogCommands)
}
