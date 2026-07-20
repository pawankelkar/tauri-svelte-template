import { commands, unwrapResult } from '$lib/tauri-bindings'
import type { AppPreferences } from '$lib/tauri-bindings'
import { createDebouncedPersist } from '$lib/utils/debounce-persist'
import { defaultPreferences, sanitizePreferences } from './preferences-schema'

const SAVE_DEBOUNCE_MS = 500

let _preferences = $state<AppPreferences>(defaultPreferences())
let _ready = $state(false)

async function persistToDisk(): Promise<void> {
  try {
    unwrapResult(
      await commands.savePreferences($state.snapshot(_preferences)),
    )
  } catch (e) {
    console.warn('Persisting preferences failed:', e)
  }
}

const _persist = createDebouncedPersist(persistToDisk, SAVE_DEBOUNCE_MS)

export function getPreferences(): AppPreferences {
  return _preferences
}

export function isPreferencesReady(): boolean {
  return _ready
}

export function setPreference<K extends keyof AppPreferences>(
  key: K,
  value: AppPreferences[K],
): void {
  _preferences[key] = value
  _persist.schedule()
}

export async function initPreferences(): Promise<AppPreferences> {
  try {
    const loaded = unwrapResult(await commands.loadPreferences())
    _preferences = sanitizePreferences(loaded)
  } catch (e) {
    console.warn('Loading preferences failed, using defaults:', e)
    _preferences = defaultPreferences()
  }
  _ready = true
  return _preferences
}

export function persistPreferencesNow(): Promise<void> {
  return _persist.flush()
}

export function __resetPreferencesForTests(): void {
  _preferences = defaultPreferences()
  _ready = false
}
