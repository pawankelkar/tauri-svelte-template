import { Menu, MenuItem, PredefinedMenuItem } from '@tauri-apps/api/menu'
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

function isSeparatorOption(opt: MenuEntryOption): opt is SeparatorOption {
  return 'item' in opt
}

async function buildAndShowMenu(options: MenuEntryOption[]): Promise<void> {
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

/**
 * The OS supplies these; they need no `action` and no translation, because
 * the platform labels them in the user's system language.
 */
type PredefinedItem = 'Undo' | 'Redo' | 'Cut' | 'Copy' | 'Paste' | 'SelectAll'

const EDIT_ITEMS = [
  'Cut',
  'Copy',
  'Paste',
  'Separator',
  'SelectAll',
] as const satisfies readonly (PredefinedItem | 'Separator')[]

const TEXT_INPUT_ITEMS = ['Undo', 'Redo', 'Separator', ...EDIT_ITEMS] as const

async function popupPredefinedMenu(
  kinds: readonly (PredefinedItem | 'Separator')[],
): Promise<void> {
  const items = await Promise.all(
    kinds.map((item) => PredefinedMenuItem.new({ item })),
  )
  const menu = await Menu.new({ items })
  await menu.popup()
}

/**
 * Builds an arbitrary native menu from a declarative list.
 *
 * @public Kept even though nothing calls it yet: custom right-click menus
 * (notes, tabs, the file tree) are among the first things upcoming features
 * need.
 */
export async function showContextMenu(
  entries: ContextMenuEntry[],
): Promise<void> {
  const options = toMenuItemOptions(entries)
  await buildAndShowMenu(options)
}

/**
 * Cut / Copy / Paste / Select All, without the Undo-Redo pair.
 *
 * @public For read-only surfaces where undo history is meaningless. Text
 * inputs should use `showTextInputContextMenu()` instead.
 */
export async function showEditContextMenu(): Promise<void> {
  await popupPredefinedMenu(EDIT_ITEMS)
}

/**
 * The full text-field menu: Undo/Redo on top of the edit items.
 *
 * Applied to plain inputs through the `textInputContextMenu` action in
 * `$lib/actions/context-menu-actions`.
 */
export async function showTextInputContextMenu(): Promise<void> {
  await popupPredefinedMenu(TEXT_INPUT_ITEMS)
}
