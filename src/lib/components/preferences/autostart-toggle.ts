import { enable, disable, isEnabled } from '@tauri-apps/plugin-autostart'
import { logger } from '$lib/logger'

export type AutostartToggleResult =
  { ok: true } | { ok: false; message: string }

/**
 * Flips the OS launch-at-login registration.
 *
 * Deliberately NOT mirrored into `AppPreferences`: the OS registration is the
 * single source of truth, so a user who removes the entry in Task Manager or
 * Login Items sees the switch agree with reality instead of a stale stored
 * bool. The pane reads `readAutostartState()` on mount for the same reason.
 *
 * Kept out of the component so it can be tested with `mockIPC` and no DOM.
 */
export async function commitAutostart(
  enabled: boolean,
): Promise<AutostartToggleResult> {
  try {
    if (enabled) {
      await enable()
    } else {
      await disable()
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, message: String(e) }
  }
}

/** Current OS registration; `false` when the plugin call fails (safe default). */
export async function readAutostartState(): Promise<boolean> {
  try {
    return await isEnabled()
  } catch (e) {
    logger.warn('Could not read the autostart state', e)
    return false
  }
}
