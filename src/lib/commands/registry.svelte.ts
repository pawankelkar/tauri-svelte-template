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

export function getCommand(id: string): AppCommand | undefined {
  return _commands.find((c) => c.id === id)
}

export function listCommands(): AppCommand[] {
  return _commands
}

export function findCommandIdForShortcut(combo: string): string | undefined {
  return _commands.find((c) => c.shortcut === combo)?.id
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
}
