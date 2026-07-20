import { Command } from '@tauri-apps/plugin-shell'
import { toast } from '$lib/stores/toast'
import { t } from '$lib/i18n/t.svelte'
import { logger } from '$lib/logger'
import { getPlatform } from '$lib/hooks/use-platform.svelte'
import { registerCommands, type AppCommand } from './registry.svelte'

export const DEMO_RUN_SHELL_COMMAND = 'demo-run-shell-command'

/**
 * Demo for tauri-plugin-shell.
 *
 * Deliberately not "open a URL" — tauri-plugin-opener already does that and is
 * registered in lib.rs. What shell uniquely offers is running a subprocess, so
 * that is what this exercises.
 *
 * The command names below (`exec-cmd`, `exec-sh`) must match the
 * `shell:allow-execute` scope in src-tauri/capabilities/default.json, which
 * pins both the executable and its arguments. Nothing user-supplied reaches the
 * shell. Delete the demo and its capability entry when you start your own app.
 */
async function runShellCommand(): Promise<void> {
  const command =
    getPlatform() === 'windows'
      ? Command.create('exec-cmd', [
          '/C',
          'echo Hello from the tauri-plugin-shell demo',
        ])
      : Command.create('exec-sh', [
          '-c',
          'echo Hello from the tauri-plugin-shell demo',
        ])

  try {
    const output = await command.execute()
    if (output.code === 0) {
      toast.success(t('demo.shellRan'), { description: output.stdout.trim() })
    } else {
      toast.error(t('demo.shellFailed'), { description: output.stderr.trim() })
    }
  } catch (e) {
    logger.error('Shell command failed', e)
    toast.error(t('demo.shellFailed'))
  }
}

const shellCommands: AppCommand[] = [
  {
    id: DEMO_RUN_SHELL_COMMAND,
    labelKey: 'commands.demoRunShellCommand',
    category: 'commands.category.demo',
    run: runShellCommand,
  },
]

export function registerShellCommands(): void {
  registerCommands(shellCommands)
}
