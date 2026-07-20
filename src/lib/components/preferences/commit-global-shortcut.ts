import { commands, unwrapResult } from '$lib/tauri-bindings'
import {
  getPreferences,
  setPreferenceImmediate,
} from '$lib/stores/preferences.svelte'
import { logger } from '$lib/logger'

export type CommitResult =
  | { ok: true }
  | { ok: false; reason: 'register' | 'persist'; message: string }

/**
 * Changes the global shortcut, keeping the OS registration and the saved
 * preference in agreement.
 *
 * Registering can fail (another application already owns the combination) and
 * so can saving. Either way the user must not be left with a shortcut that
 * works but isn't saved, or is saved but doesn't work — so each failure path
 * restores the previous state before reporting.
 *
 * Kept out of the component so it can be tested with `mockIPC` and no DOM.
 */
export async function commitGlobalShortcut(
  next: string | null,
): Promise<CommitResult> {
  const previous = getPreferences().globalShortcut
  if (previous === next) return { ok: true }

  try {
    if (previous) unwrapResult(await commands.unregisterGlobalShortcut())
    if (next) unwrapResult(await commands.registerGlobalShortcut(next))
  } catch (e) {
    // Nothing was persisted yet, so only the OS registration needs restoring.
    if (previous) {
      try {
        unwrapResult(await commands.registerGlobalShortcut(previous))
      } catch (restoreError) {
        logger.warn('Could not restore previous global shortcut', restoreError)
      }
    }
    return { ok: false, reason: 'register', message: String(e) }
  }

  try {
    await setPreferenceImmediate('globalShortcut', next)
    return { ok: true }
  } catch (e) {
    // The preference rolled itself back; undo the registration to match.
    try {
      if (next) unwrapResult(await commands.unregisterGlobalShortcut())
      if (previous) unwrapResult(await commands.registerGlobalShortcut(previous))
    } catch (rollbackError) {
      logger.warn('Could not roll back global shortcut', rollbackError)
    }
    return { ok: false, reason: 'persist', message: String(e) }
  }
}
