import { commands } from '$lib/tauri-bindings'
import { persistPreferencesNow } from '$lib/stores/preferences.svelte'
import { persistAppStateNow } from '$lib/stores/app-state.svelte'

/**
 * Drains every debounced store to disk.
 *
 * Both ways out of the app — the window's close handshake and the explicit
 * quit command — go through here, so a new persisted store only has to be
 * added in one place to be safe on exit.
 */
export function flushAllStores(): Promise<void> {
  return Promise.all([persistPreferencesNow(), persistAppStateNow()]).then(
    () => undefined,
  )
}

/**
 * Ends the process, flushing first.
 *
 * Distinct from closing the main window: on macOS a close only hides, so quit
 * needs its own path. `quit_app` never returns — the process is gone before
 * the promise settles.
 */
export async function requestQuit(): Promise<void> {
  await flushAllStores()
  await commands.quitApp()
}
