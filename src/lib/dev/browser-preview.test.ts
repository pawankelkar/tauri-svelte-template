import { describe, it, expect, vi } from 'vitest'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { listen } from '@tauri-apps/api/event'
import { platform } from '@tauri-apps/plugin-os'
import { commands } from '$lib/tauri-bindings'
import { defaultPreferences } from '$lib/stores/preferences-schema'
import { defaultAppState } from '$lib/stores/app-state-schema'
import { logger } from '$lib/logger'
import {
  createPreviewHandler,
  detectPlatform,
  installBrowserPreview,
} from './browser-preview'

function setup() {
  const emitEvent = vi.fn()
  const openUrl = vi.fn()
  const handle = createPreviewHandler({
    platform: 'macos',
    emitEvent,
    openUrl,
  })
  return { handle, emitEvent, openUrl }
}

describe('detectPlatform', () => {
  it('maps user agents onto the three desktop platforms', () => {
    expect(
      detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'),
    ).toBe('macos')
    expect(detectPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(
      'windows',
    )
    expect(detectPlatform('Mozilla/5.0 (X11; Linux x86_64)')).toBe('linux')
  })
})

describe('createPreviewHandler', () => {
  it('serves the schema defaults for preferences and app state', () => {
    const { handle } = setup()
    expect(handle('load_preferences')).toEqual(defaultPreferences())
    expect(handle('load_app_state')).toEqual(defaultAppState())
  })

  it('keeps saved preferences for the rest of the session', () => {
    const { handle } = setup()
    const prefs = { ...defaultPreferences(), fontSize: 18 }
    expect(handle('save_preferences', { preferences: prefs })).toBeNull()
    expect(handle('load_preferences')).toEqual(prefs)
  })

  it('persists offline mode and emits network:policy-changed', () => {
    const { handle, emitEvent } = setup()
    expect(handle('get_network_status')).toMatchObject({ offline: true })

    const policy = handle('set_offline_mode', { offline: false })
    expect(policy).toMatchObject({ offline: false, allowLocalhost: true })
    expect(handle('get_network_status')).toEqual(policy)
    expect(emitEvent).toHaveBeenCalledWith('network:policy-changed', policy)
  })

  it('flips entitlements and emits entitlements:changed', () => {
    const { handle, emitEvent } = setup()
    const list = handle('set_entitlement', {
      feature: 'pdfAiQa',
      enabled: true,
    })
    expect(list).toContainEqual({ feature: 'pdfAiQa', enabled: true })
    expect(handle('get_entitlements')).toEqual(list)
    expect(emitEvent).toHaveBeenCalledWith('entitlements:changed', list)
  })

  it('rejects the updater with a featureDisabled CoreError', () => {
    const { handle } = setup()
    expect(() => handle('check_for_update')).toThrow(
      expect.objectContaining({ kind: 'featureDisabled' }),
    )
  })

  it('returns a resource id pair for native menus', () => {
    const { handle } = setup()
    const [rid, id] = handle('plugin:menu|new', {
      kind: 'MenuItem',
      options: { id: 'app-quit' },
    }) as [number, string]
    expect(typeof rid).toBe('number')
    expect(id).toBe('app-quit')
  })

  it('routes opener URLs to the browser', () => {
    const { handle, openUrl } = setup()
    handle('plugin:opener|open_url', { url: 'https://example.com' })
    expect(openUrl).toHaveBeenCalledWith('https://example.com')
  })

  it('returns null for unknown commands and warns once per name', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const { handle } = setup()
    expect(handle('does_not_exist')).toBeNull()
    expect(handle('does_not_exist')).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})

describe('installBrowserPreview', () => {
  it('lets the bindings, window API and events run without Tauri', async () => {
    vi.spyOn(logger, 'info').mockImplementation(() => {})
    installBrowserPreview('main')

    expect(getCurrentWindow().label).toBe('main')
    expect(['macos', 'windows', 'linux']).toContain(platform())
    expect(await commands.loadPreferences()).toEqual({
      status: 'ok',
      data: defaultPreferences(),
    })
    expect(await commands.checkForUpdate()).toMatchObject({
      status: 'error',
      error: { kind: 'featureDisabled' },
    })

    const onChange = vi.fn()
    await listen('network:policy-changed', (e) => onChange(e.payload))
    await commands.setOfflineMode(false)
    await vi.waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ offline: false }),
      ),
    )

    document.querySelector('[data-browser-preview]')?.remove()
  })
})
