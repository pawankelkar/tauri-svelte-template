import { describe, it, expect, vi, beforeEach } from 'vitest'

const prefs = vi.hoisted(() => ({
  current: { prefsVersion: 0 } as { prefsVersion?: number },
}))

vi.mock('$lib/logger', () => ({
  warn: vi.fn(),
  logger: { warn: vi.fn() },
}))
vi.mock('$lib/stores/preferences.svelte', () => ({
  getPreferences: () => prefs.current,
  setPreference: vi.fn((key: string, value: unknown) => {
    ;(prefs.current as Record<string, unknown>)[key] = value
  }),
}))
vi.mock('$lib/stores/toast', () => ({ toast: { info: vi.fn() } }))
// Only the id is needed; the real module drags in theme, lifecycle, and IPC.
vi.mock('./app-commands', () => ({
  OPEN_COMMAND_PALETTE: 'open-command-palette',
}))

import { setPreference } from '$lib/stores/preferences.svelte'
import { toast } from '$lib/stores/toast'
import { runKeymapMigration } from './keymap-migration'
import {
  registerCommand,
  setShortcutOverrideResolver,
  __resetCommandsForTests,
} from './registry.svelte'

function registerPalette(): void {
  registerCommand({
    id: 'open-command-palette',
    labelKey: 'commands.openCommandPalette',
    category: 'commands.category.general',
    shortcut: 'mod+shift+p',
    run: vi.fn(),
  })
}

describe('runKeymapMigration', () => {
  beforeEach(() => {
    __resetCommandsForTests()
    vi.clearAllMocks()
    registerPalette()
  })

  it('announces the new palette shortcut once and stamps version 1', () => {
    prefs.current = { prefsVersion: 0 }

    runKeymapMigration()

    expect(toast.info).toHaveBeenCalledOnce()
    // Outside Tauri the platform falls back to macOS.
    expect(vi.mocked(toast.info).mock.calls[0]![0]).toContain('⇧⌘P')
    expect(setPreference).toHaveBeenCalledWith('prefsVersion', 1)

    runKeymapMigration()
    expect(toast.info).toHaveBeenCalledOnce()
  })

  it('treats a missing version as a pre-versioning file', () => {
    prefs.current = {}
    runKeymapMigration()
    expect(toast.info).toHaveBeenCalledOnce()
    expect(setPreference).toHaveBeenCalledWith('prefsVersion', 1)
  })

  it('does nothing on an already-current install', () => {
    prefs.current = { prefsVersion: 1 }
    runKeymapMigration()
    expect(toast.info).not.toHaveBeenCalled()
    expect(setPreference).not.toHaveBeenCalled()
  })

  it('stays quiet when the user already rebound the palette', () => {
    prefs.current = { prefsVersion: 0 }
    setShortcutOverrideResolver((id) =>
      id === 'open-command-palette' ? 'mod+k' : undefined,
    )

    runKeymapMigration()

    expect(toast.info).not.toHaveBeenCalled()
    // Still stamped, so the check never runs again.
    expect(setPreference).toHaveBeenCalledWith('prefsVersion', 1)
  })
})
