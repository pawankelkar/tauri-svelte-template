import { getPreferences, setPreference } from '$lib/stores/preferences.svelte'
import { fromTauriAccelerator } from '$lib/shortcuts'
import { rebuildMenu } from '$lib/menu'
import {
  getCommand,
  getEffectiveShortcut,
  isCommandVisible,
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

type GlobalShortcutPurpose = 'focusMain' | 'quickPane'

/**
 * What stands in the way of binding a combo:
 *
 * - `conflict` — another command fires in the same context (either side has
 *   no `when`, or both have the identical one). Blocks saving.
 * - `warning` — another command owns the combo under a different `when`.
 *   Both can coexist, so saving is allowed; the UI just says so.
 * - `reserved` — the OS (`reason: 'os'`) or one of this app's own global
 *   shortcuts (`reason: 'global'`) takes the keypress before the in-app
 *   dispatcher sees it. Blocks saving.
 */
export type ShortcutConflict =
  | { kind: 'conflict'; commandId: string }
  | { kind: 'warning'; commandId: string }
  | { kind: 'reserved'; reason: 'os' }
  | { kind: 'reserved'; reason: 'global'; purpose: GlobalShortcutPurpose }

/**
 * Combos the operating system (or window manager) handles itself: quit,
 * hide, minimise, app switcher, input-source / Spotlight, and Windows'
 * close-window chord. Listed in normalised form, and applied on every
 * platform so a keymap stays portable.
 *
 * `mod+w` is deliberately absent: it is the shipped default for `tab.close`
 * (the chord every tabbed app uses), so users must be able to move it and
 * bind it back.
 */
const OS_RESERVED_SHORTCUTS: ReadonlySet<string> = new Set([
  'mod+q',
  'mod+h',
  'mod+m',
  'mod+tab',
  'mod+space',
  'alt+f4',
])

export function isReservedShortcut(combo: string): boolean {
  return OS_RESERVED_SHORTCUTS.has(combo)
}

/** Whether saving should be refused (as opposed to merely noted). */
export function isBlockingConflict(conflict: ShortcutConflict): boolean {
  return conflict.kind !== 'warning'
}

/**
 * Classifies what already owns `combo` for the command `excludeCommandId`
 * is being rebound on, or returns `null` if it is free. Checks, in order:
 * the OS-reserved list (skipped when `combo` is the command's own built-in
 * default — restoring a default is always allowed, whatever the list says);
 * the two OS-level global shortcuts (those fire before
 * the in-app dispatcher ever sees the keydown, so a colliding in-app binding
 * would be unreachable); then the effective (post-override) binding of every
 * other command visible on this platform — a blocking `conflict` anywhere
 * beats a `warning`.
 */
export function findShortcutConflict(
  combo: string,
  excludeCommandId: string,
): ShortcutConflict | null {
  const ownCommand = getCommand(excludeCommandId)
  const isOwnDefault = ownCommand?.shortcut === combo
  if (!isOwnDefault && isReservedShortcut(combo)) {
    return { kind: 'reserved', reason: 'os' }
  }

  const prefs = getPreferences()
  const globals: [GlobalShortcutPurpose, string | null][] = [
    ['focusMain', prefs.globalShortcut],
    ['quickPane', prefs.quickPaneShortcut],
  ]
  for (const [purpose, accelerator] of globals) {
    if (!accelerator) continue
    const { key, modifiers } = fromTauriAccelerator(accelerator)
    if ([...modifiers, key].join('+') === combo) {
      return { kind: 'reserved', reason: 'global', purpose }
    }
  }

  const ownWhen = ownCommand?.when?.trim() ?? ''
  let warning: ShortcutConflict | null = null
  for (const command of listCommands()) {
    if (command.id === excludeCommandId) continue
    if (!isCommandVisible(command)) continue
    if (getEffectiveShortcut(command) !== combo) continue

    const otherWhen = command.when?.trim() ?? ''
    if (!ownWhen || !otherWhen || ownWhen === otherWhen) {
      return { kind: 'conflict', commandId: command.id }
    }
    warning ??= { kind: 'warning', commandId: command.id }
  }

  return warning
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
