import { SvelteSet } from 'svelte/reactivity'
import { commands } from '$lib/tauri-bindings'

/**
 * Unsaved-work tracking for the quit gate.
 *
 * Two inputs feed one answer: a manual flag (`setHasUnsavedChanges`, used by
 * the Advanced pane's toggle and cleared when the user accepts the quit
 * prompt) and named sources (`setUnsavedSource`, e.g. `'tabs'` while any tab
 * is dirty). The app has unsaved changes if either says so. Sources are not
 * cleared by accepting the prompt: the work behind them really is still
 * unsaved, so a hidden-not-quit window must ask again next time.
 */
let _manual = $state(false)
const _sources = new SvelteSet<string>()
let _reported: boolean | null = null

export function getHasUnsavedChanges(): boolean {
  return _manual || _sources.size > 0
}

/** Mirrors the combined flag to the backend, only when it changes. */
function report(): void {
  const value = getHasUnsavedChanges()
  if (value === _reported) return
  _reported = value
  void commands.setHasUnsavedChanges($state.snapshot(value))
}

export function setHasUnsavedChanges(value: boolean): void {
  _manual = value
  report()
}

/** Marks (or clears) one named contributor to the unsaved-changes flag. */
export function setUnsavedSource(source: string, dirty: boolean): void {
  if (dirty) _sources.add(source)
  else _sources.delete(source)
  report()
}

export function __resetDirtyForTests(): void {
  _manual = false
  _sources.clear()
  _reported = null
}
