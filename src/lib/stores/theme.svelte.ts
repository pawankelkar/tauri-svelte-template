import { emit } from '@tauri-apps/api/event'
import { getPreferences, setPreference } from './preferences.svelte'
import { THEME_STORAGE_KEY } from '$lib/theme/paint-hint'
import type { ThemeMode } from './preferences-schema'

let _systemDark = $state(
  typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches,
)

export function getThemeMode(): ThemeMode {
  return getPreferences().theme as ThemeMode
}

export function getResolvedMode(): 'light' | 'dark' {
  const mode = getThemeMode()
  return mode === 'system' ? (_systemDark ? 'dark' : 'light') : mode
}

function applyClass(target: HTMLElement = document.documentElement): void {
  target.classList.toggle('dark', getResolvedMode() === 'dark')
}

function syncHint(): void {
  localStorage.setItem(THEME_STORAGE_KEY, getThemeMode())
}

function repaint(): void {
  applyClass()
  syncHint()
}

/**
 * Tells the other windows to repaint.
 *
 * They have their own JS contexts and cannot see this store, but they can read
 * the `localStorage` hint — which `syncHint()` has already written by the time
 * this fires — so the payload is informational and the event is the trigger.
 */
function broadcast(): void {
  void emit('theme-changed', {
    mode: getThemeMode(),
    resolved: getResolvedMode(),
  })
}

export function initTheme(): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  _systemDark = mq.matches
  const onChange = (e: MediaQueryListEvent) => {
    _systemDark = e.matches
    if (getThemeMode() === 'system') {
      repaint()
      // A system-level flip changes the resolved theme without anyone touching
      // a preference, so the other windows need telling here too.
      broadcast()
    }
  }
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

export function reconcileTheme(): void {
  repaint()
}

export function setThemeMode(mode: ThemeMode): void {
  setPreference('theme', mode)
  repaint()
  broadcast()
}
