import { describe, it, expect } from 'vitest'
import {
  isSeparator,
  toMenuItemOptions,
  type ContextMenuItem,
  type ContextMenuSeparator,
  type ContextMenuEntry,
} from './context-menu'

describe('isSeparator', () => {
  it('returns true for a separator', () => {
    const sep: ContextMenuSeparator = { separator: true }
    expect(isSeparator(sep)).toBe(true)
  })

  it('returns false for a menu item', () => {
    const item: ContextMenuItem = {
      id: 'copy',
      labelKey: 'edit.copy',
      action: () => {},
    }
    expect(isSeparator(item)).toBe(false)
  })
})

describe('toMenuItemOptions', () => {
  it('maps menu items to options with resolved text', () => {
    const entries: ContextMenuEntry[] = [
      { id: 'action-1', labelKey: 'commands.toggleTheme', action: () => {} },
    ]
    const options = toMenuItemOptions(entries)
    expect(options).toHaveLength(1)
    const opt = options[0]!
    expect('id' in opt).toBe(true)
    if ('id' in opt) {
      expect(opt.id).toBe('action-1')
      expect(opt.text).toBe('Toggle Theme')
      expect(opt.enabled).toBe(true)
    }
  })

  it('maps separators', () => {
    const entries: ContextMenuEntry[] = [{ separator: true }]
    const options = toMenuItemOptions(entries)
    expect(options).toEqual([{ item: 'Separator' }])
  })

  it('maps disabled items to enabled: false', () => {
    const entries: ContextMenuEntry[] = [
      {
        id: 'disabled-action',
        labelKey: 'commands.quit',
        action: () => {},
        disabled: true,
      },
    ]
    const options = toMenuItemOptions(entries)
    const opt = options[0]!
    if ('id' in opt) {
      expect(opt.enabled).toBe(false)
    }
  })

  it('handles mixed entries', () => {
    const entries: ContextMenuEntry[] = [
      { id: 'a', labelKey: 'commands.quit', action: () => {} },
      { separator: true },
      { id: 'b', labelKey: 'commands.toggleTheme', action: () => {}, disabled: true },
    ]
    const options = toMenuItemOptions(entries)
    expect(options).toHaveLength(3)
    expect('item' in options[1]!).toBe(true)
  })
})
