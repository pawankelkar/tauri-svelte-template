export {
  registerCommand,
  registerCommands,
  unregisterCommand,
  getCommand,
  listCommands,
  findCommandIdForShortcut,
  executeCommand,
  type AppCommand,
} from './registry.svelte'

export {
  isPaletteOpen,
  openPalette,
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

export { DEMO_SEND_NOTIFICATION } from './notification-commands'
export {
  DEMO_COPY_TO_CLIPBOARD,
  DEMO_PASTE_FROM_CLIPBOARD,
} from './clipboard-commands'
export { DEMO_OPEN_FILE_DIALOG } from './dialog-commands'
export { DEMO_RUN_SHELL_COMMAND } from './shell-commands'
export { demoRelaunchApp } from './process-commands'

import { registerAppCommands } from './app-commands'
import { registerNotificationCommands } from './notification-commands'
import { registerClipboardCommands } from './clipboard-commands'
import { registerDialogCommands } from './dialog-commands'
import { registerShellCommands } from './shell-commands'
import {
  findCommandIdForShortcut,
  executeCommand,
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

  const handleKeydown = createKeydownHandler(
    ['mod+k'],
    findCommandIdForShortcut,
    (id) => void executeCommand(id),
  )
  window.addEventListener('keydown', handleKeydown)

  let cleanupMenu: (() => void) | undefined
  void initMenu().then((fn) => {
    cleanupMenu = fn
  })

  return () => {
    window.removeEventListener('keydown', handleKeydown)
    cleanupMenu?.()
  }
}
