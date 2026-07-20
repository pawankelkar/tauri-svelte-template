import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockIPC } from '@tauri-apps/api/mocks'

vi.mock('$lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
}))

import { commitGlobalShortcut } from './commit-global-shortcut'
import {
  initPreferences,
  getPreferences,
  __resetPreferencesForTests,
} from '$lib/stores/preferences.svelte'
import { defaultPreferences } from '$lib/stores/preferences-schema'

interface Scenario {
  /** Shortcut already saved and registered before the change. */
  existing?: string | null
  failOn?: 'register_global_shortcut' | 'save_preferences'
}

/**
 * Installs an IPC mock and records the ordered command names it received, so
 * tests can assert on the unregister-old -> register-new -> persist sequence
 * and on what a rollback undoes.
 */
async function setup({ existing = null, failOn }: Scenario = {}) {
  const calls: { cmd: string; args: unknown }[] = []

  mockIPC((cmd, args) => {
    calls.push({ cmd, args })

    if (cmd === 'load_preferences') {
      return { ...defaultPreferences(), globalShortcut: existing }
    }
    if (cmd === failOn) {
      throw new Error(`${cmd} failed`)
    }
    if (
      cmd === 'save_preferences' ||
      cmd === 'register_global_shortcut' ||
      cmd === 'unregister_global_shortcut'
    ) {
      return null
    }
  })

  await initPreferences()
  calls.length = 0
  return {
    calls,
    names: () => calls.map((c) => c.cmd),
  }
}

beforeEach(() => {
  __resetPreferencesForTests()
})

describe('commitGlobalShortcut', () => {
  it('does nothing when the accelerator is unchanged', async () => {
    const { names } = await setup({ existing: 'CmdOrCtrl+K' })

    const result = await commitGlobalShortcut('CmdOrCtrl+K')

    expect(result).toEqual({ ok: true })
    expect(names()).toEqual([])
  })

  it('registers then persists when setting a first shortcut', async () => {
    const { calls, names } = await setup({ existing: null })

    const result = await commitGlobalShortcut('CmdOrCtrl+Shift+K')

    expect(result).toEqual({ ok: true })
    // Nothing was registered before, so there is no unregister step.
    expect(names()).toEqual(['register_global_shortcut', 'save_preferences'])
    expect(calls[0]?.args).toMatchObject({ accelerator: 'CmdOrCtrl+Shift+K' })
    expect(getPreferences().globalShortcut).toBe('CmdOrCtrl+Shift+K')
  })

  it('unregisters the old shortcut before registering the new one', async () => {
    const { names } = await setup({ existing: 'CmdOrCtrl+K' })

    const result = await commitGlobalShortcut('CmdOrCtrl+Shift+P')

    expect(result).toEqual({ ok: true })
    expect(names()).toEqual([
      'unregister_global_shortcut',
      'register_global_shortcut',
      'save_preferences',
    ])
    expect(getPreferences().globalShortcut).toBe('CmdOrCtrl+Shift+P')
  })

  it('clears the shortcut without registering anything new', async () => {
    const { names } = await setup({ existing: 'CmdOrCtrl+K' })

    const result = await commitGlobalShortcut(null)

    expect(result).toEqual({ ok: true })
    expect(names()).toEqual(['unregister_global_shortcut', 'save_preferences'])
    expect(getPreferences().globalShortcut).toBeNull()
  })

  it('restores the previous registration and saves nothing when register fails', async () => {
    const { calls, names } = await setup({
      existing: 'CmdOrCtrl+K',
      failOn: 'register_global_shortcut',
    })

    const result = await commitGlobalShortcut('CmdOrCtrl+Shift+P')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('register')

    // The old shortcut is re-registered, and nothing is written to disk.
    expect(names()).toEqual([
      'unregister_global_shortcut',
      'register_global_shortcut',
      'register_global_shortcut',
    ])
    expect(calls.at(-1)?.args).toMatchObject({ accelerator: 'CmdOrCtrl+K' })
    expect(names()).not.toContain('save_preferences')
    expect(getPreferences().globalShortcut).toBe('CmdOrCtrl+K')
  })

  it('rolls the registration back when persisting fails', async () => {
    const { calls, names } = await setup({
      existing: 'CmdOrCtrl+K',
      failOn: 'save_preferences',
    })

    const result = await commitGlobalShortcut('CmdOrCtrl+Shift+P')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('persist')

    expect(names()).toEqual([
      'unregister_global_shortcut',
      'register_global_shortcut',
      'save_preferences',
      'unregister_global_shortcut',
      'register_global_shortcut',
    ])
    // The OS ends up back on the old accelerator, matching the reverted
    // in-memory preference.
    expect(calls.at(-1)?.args).toMatchObject({ accelerator: 'CmdOrCtrl+K' })
    expect(getPreferences().globalShortcut).toBe('CmdOrCtrl+K')
  })
})
