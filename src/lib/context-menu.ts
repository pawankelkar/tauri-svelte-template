import {
  Menu,
  MenuItem,
  PredefinedMenuItem,
} from '@tauri-apps/api/menu'
import i18n from '$lib/i18n/config'

export interface ContextMenuItem {
  id: string
  labelKey: string
  action: () => void
  disabled?: boolean
}

export interface ContextMenuSeparator {
  separator: true
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator

export function isSeparator(
  entry: ContextMenuEntry,
): entry is ContextMenuSeparator {
  return 'separator' in entry && entry.separator === true
}

export interface MenuItemOption {
  id: string
  text: string
  enabled: boolean
  action: () => void
}

export interface SeparatorOption {
  item: 'Separator'
}

export type MenuEntryOption = MenuItemOption | SeparatorOption

export function toMenuItemOptions(
  entries: ContextMenuEntry[],
): MenuEntryOption[] {
  return entries.map((entry) => {
    if (isSeparator(entry)) {
      return { item: 'Separator' as const }
    }
    return {
      id: entry.id,
      text: i18n.t(entry.labelKey),
      enabled: !entry.disabled,
      action: entry.action,
    }
  })
}

function isSeparatorOption(
  opt: MenuEntryOption,
): opt is SeparatorOption {
  return 'item' in opt
}

async function buildAndShowMenu(
  options: MenuEntryOption[],
): Promise<void> {
  const items = await Promise.all(
    options.map((opt) => {
      if (isSeparatorOption(opt)) {
        return PredefinedMenuItem.new({ item: 'Separator' })
      }
      return MenuItem.new({
        id: opt.id,
        text: opt.text,
        enabled: opt.enabled,
        action: opt.action,
      })
    }),
  )
  const menu = await Menu.new({ items })
  await menu.popup()
}

export async function showContextMenu(
  entries: ContextMenuEntry[],
): Promise<void> {
  const options = toMenuItemOptions(entries)
  await buildAndShowMenu(options)
}

export async function showEditContextMenu(): Promise<void> {
  const items = await Promise.all([
    PredefinedMenuItem.new({ item: 'Cut' }),
    PredefinedMenuItem.new({ item: 'Copy' }),
    PredefinedMenuItem.new({ item: 'Paste' }),
    PredefinedMenuItem.new({ item: 'Separator' }),
    PredefinedMenuItem.new({ item: 'SelectAll' }),
  ])
  const menu = await Menu.new({ items })
  await menu.popup()
}

export async function showTextInputContextMenu(): Promise<void> {
  const items = await Promise.all([
    PredefinedMenuItem.new({ item: 'Undo' }),
    PredefinedMenuItem.new({ item: 'Redo' }),
    PredefinedMenuItem.new({ item: 'Separator' }),
    PredefinedMenuItem.new({ item: 'Cut' }),
    PredefinedMenuItem.new({ item: 'Copy' }),
    PredefinedMenuItem.new({ item: 'Paste' }),
    PredefinedMenuItem.new({ item: 'Separator' }),
    PredefinedMenuItem.new({ item: 'SelectAll' }),
  ])
  const menu = await Menu.new({ items })
  await menu.popup()
}
