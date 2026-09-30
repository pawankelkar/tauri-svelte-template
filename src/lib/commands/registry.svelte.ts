import type { Component } from 'svelte'
import { warn } from '$lib/logger'
import { getPlatform, type AppPlatform } from '$lib/hooks/use-platform.svelte'
import { evaluateWhen, whenSpecificity } from './context-keys.svelte'

/** Who contributed a command — breaks ties between bindings on one combo. */
export type CommandSource = 'core' | 'plugin' | 'user'

export interface AppCommand {
  id: string
  labelKey: string
  label?: () => string
  category: string
  /** Default combo in normalised form, e.g. `'mod+shift+p'`. User-rebindable. */
  shortcut?: string
  /** Receives `args` (or the caller's override) when run via `executeCommand`. */
  run: (args?: unknown) => void | Promise<void>
  /**
   * Context-key expression gating the keyboard shortcut, e.g.
   * `'editorFocus && !recording'` (see `context-keys.svelte.ts`). Empty means
   * "everywhere". A scoped command gets no native menu accelerator, because
   * those fire regardless of focus.
   */
  when?: string
  /** Let the shortcut fire while focus is in an input/textarea/contenteditable. */
  allowInInput?: boolean
  /** Default argument passed to `run`. */
  args?: unknown
  /** Documentation URL. */
  docs?: string
  /** i18n key for a one-line description. */
  descriptionKey?: string
  /** Extra palette search terms (not shown). */
  keywords?: string[]
  /** Defaults to `'core'` at registration. */
  source?: CommandSource
  icon?: Component
  /** Evaluated on demand; a disabled command cannot run from any surface. */
  isEnabled?: () => boolean
  /** Restricts the command to these OSes; omitted means all of them. */
  platforms?: AppPlatform[]
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
  _commands.push({ ...command, source: command.source ?? 'core' })
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

/** Whether the command exists on this OS. Hidden commands never surface. */
export function isCommandVisible(command: AppCommand): boolean {
  return !command.platforms || command.platforms.includes(getPlatform())
}

export function isCommandEnabled(command: AppCommand): boolean {
  return command.isEnabled?.() ?? true
}

const SOURCE_RANK: Record<CommandSource, number> = {
  user: 2,
  plugin: 1,
  core: 0,
}

/**
 * The command a keypress should run: among visible, enabled commands whose
 * effective shortcut is `combo` and whose `when` currently holds, the one
 * that wins on (in order) being a user override, having the more specific
 * `when`, and its source (user > plugin > core). Registration order breaks
 * any remaining tie.
 */
export function resolveShortcut(combo: string): AppCommand | undefined {
  let best: AppCommand | undefined
  let bestRank: number[] = []

  for (const command of _commands) {
    if (getEffectiveShortcut(command) !== combo) continue
    if (!isCommandVisible(command) || !isCommandEnabled(command)) continue
    if (!evaluateWhen(command.when)) continue

    const rank = [
      typeof _resolveShortcutOverride(command.id) === 'string' ? 1 : 0,
      whenSpecificity(command.when),
      SOURCE_RANK[command.source ?? 'core'],
    ]
    if (!best || isHigherRank(rank, bestRank)) {
      best = command
      bestRank = rank
    }
  }
  return best
}

function isHigherRank(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i]! > b[i]!
  }
  return false
}

/**
 * Runs a command by id. `args` overrides the command's own default `args`.
 * Disabled and platform-hidden commands are skipped silently — the menu or a
 * stale caller reaching one is not an error worth surfacing.
 */
export async function executeCommand(
  id: string,
  args?: unknown,
): Promise<void> {
  const command = getCommand(id)
  if (!command) {
    warn(`Unknown command: "${id}"`)
    return
  }
  if (!isCommandVisible(command) || !isCommandEnabled(command)) return
  await command.run(args ?? command.args)
}

export function __resetCommandsForTests(): void {
  _commands = []
  _resolveShortcutOverride = () => undefined
}
