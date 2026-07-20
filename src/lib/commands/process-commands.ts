import { relaunch } from '@tauri-apps/plugin-process'
import { confirm } from '$lib/stores/confirm.svelte'
import { toast } from '$lib/stores/toast'
import { t } from '$lib/i18n/t.svelte'
import { logger } from '$lib/logger'

/**
 * Demo for tauri-plugin-process.
 *
 * Not registered in the command registry on purpose: restarting the app is
 * disruptive enough that it shouldn't be one fuzzy match away in the command
 * palette. It is exposed as a WelcomePane button instead.
 *
 * There is deliberately no `exit()` demo either — it would terminate the
 * process directly and bypass the two-phase close handshake in lib.rs that
 * flushes preferences and app state to disk. Use the existing `app-quit`
 * command (which closes the window) to quit.
 */
export async function demoRelaunchApp(): Promise<void> {
  const confirmed = await confirm({
    titleKey: 'demo.relaunchConfirmTitle',
    descriptionKey: 'demo.relaunchConfirmDescription',
    confirmKey: 'demo.relaunchConfirmAction',
  })
  if (!confirmed) return

  try {
    await relaunch()
  } catch (e) {
    logger.error('Relaunch failed', e)
    toast.error(t('demo.relaunchFailed'))
  }
}
