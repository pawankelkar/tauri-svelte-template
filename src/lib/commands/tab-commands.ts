import {
  closeOtherTabs,
  closeTab,
  getActiveTab,
  getGroupTabs,
  hasClosedTabs,
  nextTab,
  prevTab,
  reopenClosedTab,
  togglePinTab,
} from '$lib/workspace/tabs.svelte'
import i18n from '$lib/i18n/config'
import { registerCommands, type AppCommand } from './registry.svelte'

export const TAB_CLOSE = 'tab.close'
export const TAB_CLOSE_OTHERS = 'tab.closeOthers'
export const TAB_NEXT = 'tab.next'
export const TAB_PREV = 'tab.prev'
export const TAB_REOPEN_CLOSED = 'tab.reopenClosed'
export const TAB_TOGGLE_PIN = 'tab.togglePin'

const CATEGORY = 'commands.category.tabs'

const hasActiveTab = (): boolean => getActiveTab() !== undefined
const hasSeveralTabs = (): boolean => getGroupTabs().length > 1

const tabCommands: AppCommand[] = [
  {
    id: TAB_CLOSE,
    labelKey: 'commands.tab.close',
    category: CATEGORY,
    // The chord every tabbed app uses. It is kept off the OS-reserved list
    // (see command-shortcuts.ts) so it can be moved and bound back. macOS has
    // no Close Window menu item here, so the keypress reaches the in-app
    // dispatcher.
    shortcut: 'mod+w',
    // Editors are contenteditable; closing a tab must work from inside one.
    allowInInput: true,
    isEnabled: hasActiveTab,
    run: () => {
      const tab = getActiveTab()
      if (tab) void closeTab(tab.id)
    },
  },
  {
    id: TAB_CLOSE_OTHERS,
    labelKey: 'commands.tab.closeOthers',
    category: CATEGORY,
    isEnabled: hasSeveralTabs,
    run: () => {
      const tab = getActiveTab()
      if (tab) void closeOtherTabs(tab.id)
    },
  },
  {
    id: TAB_NEXT,
    labelKey: 'commands.tab.next',
    category: CATEGORY,
    shortcut: 'mod+alt+arrowright',
    allowInInput: true,
    isEnabled: hasSeveralTabs,
    run: nextTab,
  },
  {
    id: TAB_PREV,
    labelKey: 'commands.tab.prev',
    category: CATEGORY,
    shortcut: 'mod+alt+arrowleft',
    allowInInput: true,
    isEnabled: hasSeveralTabs,
    run: prevTab,
  },
  {
    id: TAB_REOPEN_CLOSED,
    labelKey: 'commands.tab.reopenClosed',
    category: CATEGORY,
    shortcut: 'mod+shift+t',
    allowInInput: true,
    isEnabled: hasClosedTabs,
    run: () => {
      reopenClosedTab()
    },
  },
  {
    id: TAB_TOGGLE_PIN,
    labelKey: 'commands.tab.togglePin',
    category: CATEGORY,
    label: () =>
      i18n.t(
        getActiveTab()?.pinned ? 'commands.tab.unpin' : 'commands.tab.pin',
      ),
    isEnabled: hasActiveTab,
    run: () => {
      const tab = getActiveTab()
      if (tab) togglePinTab(tab.id)
    },
  },
]

export function registerTabCommands(): void {
  registerCommands(tabCommands)
}
