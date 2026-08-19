import { commands } from '$lib/tauri-bindings'

let _dirty = $state(false)

export function getHasUnsavedChanges(): boolean {
  return _dirty
}

export function setHasUnsavedChanges(value: boolean): void {
  _dirty = value
  void commands.setHasUnsavedChanges($state.snapshot(value))
}
