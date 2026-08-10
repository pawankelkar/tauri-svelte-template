import { warn } from '$lib/logger'

export interface AppCommand {
  id: string
  labelKey: string
  label?: () => string
  category: string
  shortcut?: string
  run: () => void | Promise<void>
}

let _commands = $state<AppCommand[]>([])

/**
 * Resolves a user override for a command's shortcut: `undefined` means "no
 * override, use the command's default", `null` means "explicitly unbound",
 * and a string is a custom combo. Injected (rather than importing the
 * preferences store here) so the registry stays dependency-free.
 */
type ShortcutOverrideResolver = (commandId: string) => string | null | undefined

let _resolveShortcutOverride: ShortcutOverrideResolver = () => undefined

export function setShortcutOverrideResolver(
  resolver: ShortcutOverrideResolver,
): void {
  _resolveShortcutOverride = resolver
}

/** The shortcut that actually fires: the user override, or the default. */
export function getEffectiveShortcut(command: AppCommand): string | undefined {
  const override = _resolveShortcutOverride(command.id)
  if (override === undefined) return command.shortcut
  return override ?? undefined
}

export function registerCommand(command: AppCommand): void {
  if (_commands.some((c) => c.id === command.id)) {
    warn(`Command "${command.id}" is already registered, skipping`)
    return
  }
  _commands.push(command)
}

export function registerCommands(commands: AppCommand[]): void {
  for (const command of commands) {
    registerCommand(command)
  }
}

export function unregisterCommand(id: string): void {
  _commands = _commands.filter((c) => c.id !== id)
}

export function unregisterAllCommands(): void {
  _commands = []
}

export function getCommand(id: string): AppCommand | undefined {
  return _commands.find((c) => c.id === id)
}

export function listCommands(): AppCommand[] {
  return _commands
}

export function findCommandIdForShortcut(combo: string): string | undefined {
  return _commands.find((c) => getEffectiveShortcut(c) === combo)?.id
}

export async function executeCommand(id: string): Promise<void> {
  const command = getCommand(id)
  if (!command) {
    warn(`Unknown command: "${id}"`)
    return
  }
  await command.run()
}

export function __resetCommandsForTests(): void {
  _commands = []
  _resolveShortcutOverride = () => undefined
}
