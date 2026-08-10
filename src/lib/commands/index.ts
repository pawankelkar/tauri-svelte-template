export {
  registerCommand,
  registerCommands,
  unregisterCommand,
  getCommand,
  listCommands,
  findCommandIdForShortcut,
  getEffectiveShortcut,
  executeCommand,
  type AppCommand,
} from './registry.svelte'

export {
  isPaletteOpen,
  closePalette,
  togglePalette,
  setPaletteOpen,
} from './palette-state.svelte'

export {
  OPEN_COMMAND_PALETTE,
  TOGGLE_THEME,
  OPEN_PREFERENCES,
  TOGGLE_LEFT_SIDEBAR,
  TOGGLE_RIGHT_SIDEBAR,
  TOGGLE_QUICK_PANE,
  APP_QUIT,
  registerAppCommands,
} from './app-commands'

export {
  isPreferencesDialogOpen,
  getActivePreferencesPane,
  setActivePreferencesPane,
  openPreferencesDialog,
  closePreferencesDialog,
  setPreferencesDialogOpen,
  type PreferencesPaneId,
} from './preferences-dialog-state.svelte'

export {
  initCommandShortcutOverrides,
  isShortcutCustomized,
  findShortcutConflict,
  setCommandShortcut,
  resetCommandShortcut,
  type ShortcutConflict,
} from './command-shortcuts'

export { DEMO_SEND_NOTIFICATION } from './notification-commands'
export {
  DEMO_COPY_TO_CLIPBOARD,
  DEMO_PASTE_FROM_CLIPBOARD,
} from './clipboard-commands'
export { DEMO_OPEN_FILE_DIALOG } from './dialog-commands'
export { DEMO_RUN_SHELL_COMMAND } from './shell-commands'
export { demoRelaunchApp } from './process-commands'

import { OPEN_COMMAND_PALETTE, registerAppCommands } from './app-commands'
import { initCommandShortcutOverrides } from './command-shortcuts'
import { registerNotificationCommands } from './notification-commands'
import { registerClipboardCommands } from './clipboard-commands'
import { registerDialogCommands } from './dialog-commands'
import { registerShellCommands } from './shell-commands'
import {
  findCommandIdForShortcut,
  getCommand,
  getEffectiveShortcut,
  executeCommand,
  unregisterAllCommands,
} from './registry.svelte'
import { createKeydownHandler } from '$lib/shortcuts'
import { initMenu } from '$lib/menu'

export function initCommands(): () => void {
  registerAppCommands()
  // Demo commands — delete these registrations (and their files) when you
  // start building your own app.
  registerNotificationCommands()
  registerClipboardCommands()
  registerDialogCommands()
  registerShellCommands()

  initCommandShortcutOverrides()

  const handleKeydown = createKeydownHandler(
    // The palette must stay reachable while an input is focused, whatever
    // the user has rebound it to.
    () => {
      const palette = getCommand(OPEN_COMMAND_PALETTE)
      const shortcut = palette ? getEffectiveShortcut(palette) : undefined
      return shortcut ? [shortcut] : []
    },
    findCommandIdForShortcut,
    (id) => void executeCommand(id),
  )
  window.addEventListener('keydown', handleKeydown)

  let cleanupMenu: (() => void) | undefined
  let destroyed = false
  void initMenu().then((fn) => {
    // HMR can run the cleanup below while the async menu build is still in
    // flight; run the late-arriving teardown immediately instead of leaking
    // the languageChanged listener it would otherwise leave behind.
    if (destroyed) {
      fn()
      return
    }
    cleanupMenu = fn
  })

  return () => {
    destroyed = true
    window.removeEventListener('keydown', handleKeydown)
    cleanupMenu?.()
    unregisterAllCommands()
  }
}
