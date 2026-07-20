import { commands, unwrapResult } from '$lib/tauri-bindings'
import type { PersistedAppState } from '$lib/tauri-bindings'
import { createDebouncedPersist } from '$lib/utils/debounce-persist'
import {
  defaultAppState,
  sanitizeAppState,
  MAX_RECENT_ITEMS,
} from './app-state-schema'

const SAVE_DEBOUNCE_MS = 800

let _appState = $state<PersistedAppState>(defaultAppState())
let _ready = $state(false)

async function persistToDisk(): Promise<void> {
  try {
    unwrapResult(
      await commands.saveAppState($state.snapshot(_appState)),
    )
  } catch (e) {
    console.warn('Persisting app state failed:', e)
  }
}

const _persist = createDebouncedPersist(persistToDisk, SAVE_DEBOUNCE_MS)

export function getAppState(): PersistedAppState {
  return _appState
}

export function isAppStateReady(): boolean {
  return _ready
}

export function setAppStateField<K extends keyof PersistedAppState>(
  key: K,
  value: PersistedAppState[K],
): void {
  _appState[key] = value
  _persist.schedule()
}

export function addRecentItem(id: string): void {
  const filtered = _appState.recentItems.filter((x) => x !== id)
  _appState.recentItems = [id, ...filtered].slice(0, MAX_RECENT_ITEMS)
  _persist.schedule()
}

export function removeRecentItem(id: string): void {
  _appState.recentItems = _appState.recentItems.filter((x) => x !== id)
  _persist.schedule()
}

export function clearRecentItems(): void {
  _appState.recentItems = []
  _persist.schedule()
}

export function completeOnboarding(): void {
  _appState.onboardingCompleted = true
  _persist.schedule()
}

export async function initAppState(): Promise<PersistedAppState> {
  try {
    const loaded = unwrapResult(await commands.loadAppState())
    _appState = sanitizeAppState(loaded)
  } catch (e) {
    console.warn('Loading app state failed, using defaults:', e)
    _appState = defaultAppState()
  }
  _ready = true
  return _appState
}

export function persistAppStateNow(): Promise<void> {
  return _persist.flush()
}

export function __resetAppStateForTests(): void {
  _appState = defaultAppState()
  _ready = false
}
