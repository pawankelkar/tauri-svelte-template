export type ShortcutModifier = 'mod' | 'shift' | 'alt'

export interface ParsedShortcut {
  key: string
  modifiers: ShortcutModifier[]
}

const MODIFIER_ALIASES: Record<string, ShortcutModifier> = {
  mod: 'mod',
  cmd: 'mod',
  command: 'mod',
  ctrl: 'mod',
  control: 'mod',
  meta: 'mod',
  super: 'mod',
  win: 'mod',
  shift: 'shift',
  alt: 'alt',
  option: 'alt',
  opt: 'alt',
}

const MODIFIER_ORDER: ShortcutModifier[] = ['mod', 'shift', 'alt']

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true
  return target.isContentEditable
}

export function normalizeShortcut(raw: string): string {
  const parts = raw
    .toLowerCase()
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean)

  const modifiers: ShortcutModifier[] = []
  let key = ''

  for (const part of parts) {
    const alias = MODIFIER_ALIASES[part]
    if (alias) {
      if (!modifiers.includes(alias)) modifiers.push(alias)
    } else {
      key = part
    }
  }

  modifiers.sort((a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b))
  return [...modifiers, key].join('+')
}

export function parseShortcut(normalized: string): ParsedShortcut {
  const parts = normalized.split('+')
  const modifiers: ShortcutModifier[] = []
  let key = ''

  for (const part of parts) {
    if (part === 'mod' || part === 'shift' || part === 'alt') {
      modifiers.push(part)
    } else {
      key = part
    }
  }

  return { key, modifiers }
}

export function buildCombo(e: KeyboardEvent): string {
  const modifiers: ShortcutModifier[] = []
  if (e.metaKey || e.ctrlKey) modifiers.push('mod')
  if (e.shiftKey) modifiers.push('shift')
  if (e.altKey) modifiers.push('alt')

  const key = e.key.toLowerCase()
  if (['control', 'meta', 'shift', 'alt'].includes(key)) {
    return modifiers.join('+')
  }

  return [...modifiers, key].join('+')
}

const TAURI_MODIFIER_MAP: Record<ShortcutModifier, string> = {
  mod: 'CmdOrCtrl',
  shift: 'Shift',
  alt: 'Alt',
}

export function toTauriAccelerator(normalized: string): string {
  const { key, modifiers } = parseShortcut(normalized)
  const parts = modifiers.map((m) => TAURI_MODIFIER_MAP[m])
  parts.push(key.length === 1 ? key.toUpperCase() : key)
  return parts.join('+')
}

const TAURI_MODIFIER_ALIASES: Record<string, ShortcutModifier> = {
  cmdorctrl: 'mod',
  commandorcontrol: 'mod',
  cmd: 'mod',
  command: 'mod',
  ctrl: 'mod',
  control: 'mod',
  meta: 'mod',
  super: 'mod',
  shift: 'shift',
  alt: 'alt',
  altgr: 'alt',
  option: 'alt',
}

/**
 * Inverse of {@link toTauriAccelerator}.
 *
 * Global shortcuts are stored as Tauri accelerators ("CmdOrCtrl+Shift+K") so
 * the Rust startup path can register them without parsing. This converts one
 * back for display via `formatShortcut()`.
 */
export function fromTauriAccelerator(accelerator: string): ParsedShortcut {
  const modifiers: ShortcutModifier[] = []
  let key = ''

  for (const part of accelerator.split('+').map((p) => p.trim())) {
    if (!part) continue
    const alias = TAURI_MODIFIER_ALIASES[part.toLowerCase()]
    if (alias) {
      if (!modifiers.includes(alias)) modifiers.push(alias)
    } else {
      key = part.toLowerCase()
    }
  }

  modifiers.sort((a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b))
  return { key, modifiers }
}

/**
 * A global shortcut needs a key and at least one modifier — the OS rejects
 * bare keys, and registering one would swallow that key everywhere.
 */
export function isValidGlobalShortcutCombo(combo: string): boolean {
  const { key, modifiers } = parseShortcut(combo)
  return key.length > 0 && modifiers.length > 0
}

export function createKeydownHandler(
  inputAllowlist: string[],
  resolveCommandId: (combo: string) => string | undefined,
  dispatch: (commandId: string) => void,
): (event: KeyboardEvent) => void {
  const allowSet = new Set(inputAllowlist)

  return (event: KeyboardEvent) => {
    const combo = buildCombo(event)
    if (!combo || !combo.includes('+')) return

    const commandId = resolveCommandId(combo)
    if (!commandId) return

    if (isEditableTarget(event.target) && !allowSet.has(combo)) return

    event.preventDefault()
    dispatch(commandId)
  }
}
