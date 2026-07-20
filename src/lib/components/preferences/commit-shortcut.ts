import { commands, unwrapResult } from '$lib/tauri-bindings'
import type { AppPreferences, ShortcutPurpose } from '$lib/tauri-bindings'
import {
  getPreferences,
  setPreferenceImmediate,
} from '$lib/stores/preferences.svelte'
import { logger } from '$lib/logger'

/**
 * The shortcuts a user can rebind, each pairing the Rust-side purpose with the
 * preference that stores it.
 *
 * Adding a third global shortcut is a two-line change here plus a variant on
 * Rust's `ShortcutPurpose` — no new commit logic, no new picker component.
 */
const PURPOSES = {
  focusMain: { purpose: 'focusMain', prefKey: 'globalShortcut' },
  quickPane: { purpose: 'quickPane', prefKey: 'quickPaneShortcut' },
} as const satisfies Record<
  string,
  { purpose: ShortcutPurpose; prefKey: keyof AppPreferences }
>

export type ShortcutPurposeId = keyof typeof PURPOSES

export type CommitResult =
  | { ok: true }
  | { ok: false; reason: 'register' | 'persist'; message: string }

/**
 * Changes one of the app's global shortcuts, keeping the OS registration and
 * the saved preference in agreement.
 *
 * Registering can fail (another application — or another purpose in this app —
 * already owns the combination) and so can saving. Either way the user must
 * not be left with a shortcut that works but isn't saved, or is saved but
 * doesn't work — so each failure path restores the previous state before
 * reporting.
 *
 * Kept out of the component so it can be tested with `mockIPC` and no DOM.
 */
export async function commitShortcut(
  id: ShortcutPurposeId,
  next: string | null,
): Promise<CommitResult> {
  const { purpose, prefKey } = PURPOSES[id]
  const previous = getPreferences()[prefKey] as string | null
  if (previous === next) return { ok: true }

  try {
    if (previous) unwrapResult(await commands.unregisterGlobalShortcut(purpose))
    if (next) unwrapResult(await commands.registerGlobalShortcut(purpose, next))
  } catch (e) {
    // Nothing was persisted yet, so only the OS registration needs restoring.
    if (previous) {
      try {
        unwrapResult(
          await commands.registerGlobalShortcut(purpose, previous),
        )
      } catch (restoreError) {
        logger.warn(`Could not restore previous ${id} shortcut`, restoreError)
      }
    }
    return { ok: false, reason: 'register', message: String(e) }
  }

  try {
    await setPreferenceImmediate(prefKey, next)
    return { ok: true }
  } catch (e) {
    // The preference rolled itself back; undo the registration to match.
    try {
      if (next) unwrapResult(await commands.unregisterGlobalShortcut(purpose))
      if (previous)
        unwrapResult(await commands.registerGlobalShortcut(purpose, previous))
    } catch (rollbackError) {
      logger.warn(`Could not roll back ${id} shortcut`, rollbackError)
    }
    return { ok: false, reason: 'persist', message: String(e) }
  }
}

/** The preference key backing a purpose — used by the picker for display. */
export function preferenceKeyFor(id: ShortcutPurposeId): keyof AppPreferences {
  return PURPOSES[id].prefKey
}
