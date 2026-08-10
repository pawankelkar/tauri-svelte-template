import { getPreferences, setPreference } from '$lib/stores/preferences.svelte'
import { fromTauriAccelerator } from '$lib/shortcuts'
import { rebuildMenu } from '$lib/menu'
import {
  getCommand,
  getEffectiveShortcut,
  listCommands,
  setShortcutOverrideResolver,
} from './registry.svelte'

/**
 * Points the registry's override resolver at the persisted
 * `commandShortcuts` preference. Called once from `initCommands()`;
 * from then on the keydown dispatcher, palette, menu, and Shortcuts
 * pane all see the user's bindings instead of the hardcoded defaults.
 */
export function initCommandShortcutOverrides(): void {
  setShortcutOverrideResolver((commandId) => {
    const overrides = getPreferences().commandShortcuts
    return commandId in overrides ? (overrides[commandId] ?? null) : undefined
  })
}

/** Whether the command's binding differs from its built-in default. */
export function isShortcutCustomized(commandId: string): boolean {
  return commandId in getPreferences().commandShortcuts
}

export type ShortcutConflict =
  | { kind: 'command'; commandId: string }
  | { kind: 'global'; purpose: 'focusMain' | 'quickPane' }

/**
 * Returns what already owns `combo`, or `null` if it is free. Checks the
 * effective (post-override) binding of every other command, plus the two
 * OS-level global shortcuts — those fire before the in-app dispatcher ever
 * sees the keydown, so a colliding in-app binding would be unreachable.
 */
export function findShortcutConflict(
  combo: string,
  excludeCommandId: string,
): ShortcutConflict | null {
  for (const command of listCommands()) {
    if (command.id === excludeCommandId) continue
    if (getEffectiveShortcut(command) === combo) {
      return { kind: 'command', commandId: command.id }
    }
  }

  const prefs = getPreferences()
  const globals: ['focusMain' | 'quickPane', string | null][] = [
    ['focusMain', prefs.globalShortcut],
    ['quickPane', prefs.quickPaneShortcut],
  ]
  for (const [purpose, accelerator] of globals) {
    if (!accelerator) continue
    const { key, modifiers } = fromTauriAccelerator(accelerator)
    if ([...modifiers, key].join('+') === combo) {
      return { kind: 'global', purpose }
    }
  }

  return null
}

function persistOverrides(
  // Matches the generated bindings type, whose Partial<> admits `undefined`
  // values that a spread of the current map carries along.
  next: Partial<Record<string, string | null>>,
): void {
  setPreference('commandShortcuts', next)
  // The native menu renders accelerators as static text, so it has to be
  // rebuilt to show the new binding (same approach as the languageChanged
  // rebuild in menu.ts).
  void rebuildMenu()
}

/**
 * Binds `combo` to the command (or unbinds it when `null`). A value equal to
 * the command's default removes the override instead of storing a redundant
 * copy, so "customized" stays meaningful.
 *
 * Conflict checking is the caller's job (via {@link findShortcutConflict}) —
 * this function trusts its input so callers can decide their own policy.
 */
export function setCommandShortcut(
  commandId: string,
  combo: string | null,
): void {
  const command = getCommand(commandId)
  if (!command) return

  const next = { ...getPreferences().commandShortcuts }
  if (combo === (command.shortcut ?? null)) {
    delete next[commandId]
  } else {
    next[commandId] = combo
  }
  persistOverrides(next)
}

/** Restores the command's built-in default binding. */
export function resetCommandShortcut(commandId: string): void {
  const next = { ...getPreferences().commandShortcuts }
  delete next[commandId]
  persistOverrides(next)
}
