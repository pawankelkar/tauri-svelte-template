import { commands, unwrapResult } from '$lib/tauri-bindings'
import type { AppPreferences } from '$lib/tauri-bindings'
import { createDebouncedPersist } from '$lib/utils/debounce-persist'
import { warn } from '$lib/logger'
import { defaultPreferences, sanitizePreferences } from './preferences-schema'

const SAVE_DEBOUNCE_MS = 500

let _preferences = $state<AppPreferences>(defaultPreferences())
let _ready = $state(false)

async function persistToDisk(): Promise<void> {
  try {
    unwrapResult(await commands.savePreferences($state.snapshot(_preferences)))
  } catch (e) {
    warn('Persisting preferences failed:', e)
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

/**
 * Writes a preference and saves it straight away, surfacing failures.
 *
 * `setPreference` is fire-and-forget: it debounces and swallows save errors,
 * which is right for routine settings. Some changes have to be reconciled with
 * state outside this store — registering a global shortcut with the OS, say —
 * and those callers need to know whether the write actually reached disk so
 * they can roll back. On failure the in-memory value is restored and the error
 * is re-thrown.
 */
export async function setPreferenceImmediate<K extends keyof AppPreferences>(
  key: K,
  value: AppPreferences[K],
): Promise<void> {
  const previous = _preferences[key]
  _preferences[key] = value
  try {
    unwrapResult(await commands.savePreferences($state.snapshot(_preferences)))
  } catch (e) {
    _preferences[key] = previous
    throw e
  }
}

export async function initPreferences(): Promise<AppPreferences> {
  try {
    const loaded = unwrapResult(await commands.loadPreferences())
    _preferences = sanitizePreferences(loaded)
  } catch (e) {
    warn('Loading preferences failed, using defaults:', e)
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
