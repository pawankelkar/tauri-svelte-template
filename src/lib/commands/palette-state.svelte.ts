import { setContextKey } from './context-keys.svelte'

let _open = $state(false)

// Every write goes through here so the `paletteOpen` context key can never
// drift from the real state.
function write(v: boolean): void {
  _open = v
  setContextKey('paletteOpen', v)
}

export function isPaletteOpen(): boolean {
  return _open
}

export function closePalette(): void {
  write(false)
}

export function togglePalette(): void {
  write(!_open)
}

export function setPaletteOpen(v: boolean): void {
  write(v)
}

export function __resetPaletteStateForTests(): void {
  write(false)
}
