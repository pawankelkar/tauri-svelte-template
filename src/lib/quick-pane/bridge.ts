import { listen } from '@tauri-apps/api/event'
import { setLastQuickPaneEntry } from '$lib/stores/ui.svelte'
import { toast } from '$lib/stores/toast'
import { t } from '$lib/i18n/t.svelte'
import { logger } from '$lib/logger'
import { QUICK_PANE_SUBMIT_EVENT } from './events'
import type { QuickPaneSubmitPayload } from './events'

/**
 * Records one Quick Pane submission in the main window.
 *
 * Split out from the listener so the interesting half — what a submission
 * actually does — is testable without a Tauri runtime.
 */
export function applyQuickPaneEntry(text: string): void {
  const entry = text.trim()
  if (!entry) return

  setLastQuickPaneEntry(entry)
  toast.success(t('quickPane.received', { text: entry }))
}

/**
 * Subscribes the main window to Quick Pane submissions.
 *
 * Returns the teardown, which callers must run: the listener outlives the
 * component that registered it otherwise, and a second mount would then apply
 * every entry twice.
 */
export function initQuickPaneBridge(): () => void {
  const unlisten = listen<QuickPaneSubmitPayload>(
    QUICK_PANE_SUBMIT_EVENT,
    (event) => {
      applyQuickPaneEntry(event.payload.text)
    },
  )

  return () => {
    void unlisten.then((fn) => fn()).catch((e: unknown) => {
      logger.warn('Removing the Quick Pane listener failed', e)
    })
  }
}
