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

import { registerAppCommands } from './app-commands'
import {
  findCommandIdForShortcut,
  executeCommand,
} from './registry.svelte'
import { createKeydownHandler } from '$lib/shortcuts'
import { initMenu } from '$lib/menu'

export function initCommands(): () => void {
  registerAppCommands()

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
