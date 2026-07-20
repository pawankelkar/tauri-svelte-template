import { getCurrentWindow } from '@tauri-apps/api/window'
import { commands, unwrapResult } from '$lib/tauri-bindings'
import { getResolvedMode, setThemeMode } from '$lib/stores/theme.svelte'
import {
  isLeftSidebarVisible,
  isRightSidebarVisible,
  toggleLeftSidebar,
  toggleRightSidebar,
} from '$lib/stores/ui.svelte'
import { togglePalette } from './palette-state.svelte'
import { registerCommands, type AppCommand } from './registry.svelte'
import i18n from '$lib/i18n/config'

export const OPEN_COMMAND_PALETTE = 'open-command-palette'
export const TOGGLE_THEME = 'toggle-theme'
export const OPEN_PREFERENCES = 'open-preferences'
export const TOGGLE_LEFT_SIDEBAR = 'toggle-left-sidebar'
export const TOGGLE_RIGHT_SIDEBAR = 'toggle-right-sidebar'
export const APP_QUIT = 'app-quit'

const appCommands: AppCommand[] = [
  {
    id: OPEN_COMMAND_PALETTE,
    labelKey: 'commands.openCommandPalette',
    category: 'commands.category.general',
    shortcut: 'mod+k',
    run: togglePalette,
  },
  {
    id: TOGGLE_THEME,
    labelKey: 'commands.toggleTheme',
    category: 'commands.category.general',
    run: () => setThemeMode(getResolvedMode() === 'dark' ? 'light' : 'dark'),
  },
  {
    id: OPEN_PREFERENCES,
    labelKey: 'commands.openPreferences',
    category: 'commands.category.general',
    shortcut: 'mod+,',
    // Phase 5 replaces this with the Preferences dialog
    run: async () => {
      unwrapResult(await commands.openPreferencesFile())
    },
  },
  {
    id: TOGGLE_LEFT_SIDEBAR,
    labelKey: 'commands.toggleLeftSidebar',
    category: 'commands.category.view',
    shortcut: 'mod+b',
    label: () =>
      i18n.t(
        isLeftSidebarVisible()
          ? 'titlebar.hideLeftSidebar'
          : 'titlebar.showLeftSidebar',
      ),
    run: toggleLeftSidebar,
  },
  {
    id: TOGGLE_RIGHT_SIDEBAR,
    labelKey: 'commands.toggleRightSidebar',
    category: 'commands.category.view',
    shortcut: 'mod+shift+b',
    label: () =>
      i18n.t(
        isRightSidebarVisible()
          ? 'titlebar.hideRightSidebar'
          : 'titlebar.showRightSidebar',
      ),
    run: toggleRightSidebar,
  },
  {
    id: APP_QUIT,
    labelKey: 'commands.quit',
    category: 'commands.category.general',
    run: () => {
      getCurrentWindow().close()
    },
  },
]

export function registerAppCommands(): void {
  registerCommands(appCommands)
}
