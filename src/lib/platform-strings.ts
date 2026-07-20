import type { AppPlatform } from '$lib/hooks/use-platform.svelte'
import type { ShortcutModifier } from '$lib/shortcuts'

export interface PlatformStrings {
  revealInFileManager: string
  fileManagerName: string
  modifierKey: string
  modifierSymbol: string
  optionKey: string
  optionSymbol: string
  preferencesLabel: string
  quitLabel: string
  trashName: string
}

const MAC_STRINGS: PlatformStrings = {
  revealInFileManager: 'Reveal in Finder',
  fileManagerName: 'Finder',
  modifierKey: 'Command',
  modifierSymbol: '⌘',
  optionKey: 'Option',
  optionSymbol: '⌥',
  preferencesLabel: 'Settings…',
  quitLabel: 'Quit',
  trashName: 'Trash',
}

const WINDOWS_STRINGS: PlatformStrings = {
  revealInFileManager: 'Show in Explorer',
  fileManagerName: 'Explorer',
  modifierKey: 'Ctrl',
  modifierSymbol: 'Ctrl',
  optionKey: 'Alt',
  optionSymbol: 'Alt',
  preferencesLabel: 'Settings',
  quitLabel: 'Exit',
  trashName: 'Recycle Bin',
}

const LINUX_STRINGS: PlatformStrings = {
  revealInFileManager: 'Show in Files',
  fileManagerName: 'Files',
  modifierKey: 'Ctrl',
  modifierSymbol: 'Ctrl',
  optionKey: 'Alt',
  optionSymbol: 'Alt',
  preferencesLabel: 'Preferences',
  quitLabel: 'Quit',
  trashName: 'Trash',
}

const PLATFORM_TABLE: Record<AppPlatform, PlatformStrings> = {
  macos: MAC_STRINGS,
  windows: WINDOWS_STRINGS,
  linux: LINUX_STRINGS,
}

export function getPlatformStrings(platform: AppPlatform): PlatformStrings {
  return PLATFORM_TABLE[platform] ?? MAC_STRINGS
}

const MAC_MODIFIER_SYMBOLS: Record<ShortcutModifier, string> = {
  mod: '⌘',
  shift: '⇧',
  alt: '⌥',
}

const MAC_MODIFIER_ORDER: ShortcutModifier[] = ['alt', 'shift', 'mod']

const STANDARD_MODIFIER_LABELS: Record<ShortcutModifier, string> = {
  mod: 'Ctrl',
  shift: 'Shift',
  alt: 'Alt',
}

export function formatShortcut(
  platform: AppPlatform,
  key: string,
  modifiers: ShortcutModifier[],
): string {
  const upperKey =
    key.length === 1
      ? key.toUpperCase()
      : key.charAt(0).toUpperCase() + key.slice(1)

  if (platform === 'macos') {
    const sorted = [...modifiers].sort(
      (a, b) => MAC_MODIFIER_ORDER.indexOf(a) - MAC_MODIFIER_ORDER.indexOf(b),
    )
    const symbols = sorted.map((m) => MAC_MODIFIER_SYMBOLS[m])
    return [...symbols, upperKey].join('')
  }

  const labels = modifiers.map((m) => STANDARD_MODIFIER_LABELS[m])
  return [...labels, upperKey].join('+')
}
