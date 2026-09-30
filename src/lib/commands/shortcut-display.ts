import { parseShortcut } from '$lib/shortcuts'
import { formatShortcut } from '$lib/platform-strings'
import { getPlatform } from '$lib/hooks/use-platform.svelte'
import { getCommand, getEffectiveShortcut } from './registry.svelte'

/**
 * A normalised combo (`mod+shift+p`) rendered for the current platform —
 * `⇧⌘P` on macOS, `Ctrl+Shift+P` elsewhere. Reactive when read inside a
 * `$derived`: the platform is state.
 */
export function formatCombo(combo: string): string {
  const { key, modifiers } = parseShortcut(combo)
  return formatShortcut(getPlatform(), key, modifiers)
}

/**
 * The command's *effective* binding (the user's override, else the default),
 * formatted for display. `null` when the command is unknown or unbound, so a
 * hint can hide itself rather than advertise a chord that does nothing.
 *
 * Use this — never a hardcoded chord — anywhere UI copy mentions a shortcut.
 */
export function formatCommandShortcut(commandId: string): string | null {
  const command = getCommand(commandId)
  const combo = command ? getEffectiveShortcut(command) : undefined
  return combo ? formatCombo(combo) : null
}
