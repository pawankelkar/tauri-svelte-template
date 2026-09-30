export {
  registerCommand,
  registerCommands,
  unregisterCommand,
  getCommand,
  listCommands,
  resolveShortcut,
  getEffectiveShortcut,
  isCommandVisible,
  isCommandEnabled,
  executeCommand,
  type AppCommand,
  type CommandSource,
} from './registry.svelte'

export {
  setContextKey,
  getContextKey,
  evaluateWhen,
} from './context-keys.svelte'

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
  isBlockingConflict,
  isReservedShortcut,
  setCommandShortcut,
  resetCommandShortcut,
  type ShortcutConflict,
} from './command-shortcuts'

export { formatCombo, formatCommandShortcut } from './shortcut-display'

import { registerAppCommands } from './app-commands'
import { registerTabCommands } from './tab-commands'
import { initCommandShortcutOverrides } from './command-shortcuts'
import { setContextKey } from './context-keys.svelte'
import { runKeymapMigration } from './keymap-migration'
import {
  resolveShortcut,
  executeCommand,
  unregisterAllCommands,
} from './registry.svelte'
import { createKeydownHandler } from '$lib/shortcuts'
import { getPlatform } from '$lib/hooks/use-platform.svelte'
import { initMenu } from '$lib/menu'

export function initCommands(): () => void {
  setContextKey('isMac', getPlatform() === 'macos')

  registerAppCommands()
  registerTabCommands()

  initCommandShortcutOverrides()

  // Needs both the loaded preferences (App.svelte awaits them before calling
  // this) and the palette command registered above.
  runKeymapMigration()

  const handleKeydown = createKeydownHandler(resolveShortcut, (id) => {
    void executeCommand(id)
  })
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
