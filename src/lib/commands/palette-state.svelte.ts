let _open = $state(false)

export function isPaletteOpen(): boolean {
  return _open
}

export function openPalette(): void {
  _open = true
}

export function closePalette(): void {
  _open = false
}

export function togglePalette(): void {
  _open = !_open
}

export function setPaletteOpen(v: boolean): void {
  _open = v
}

export function __resetPaletteStateForTests(): void {
  _open = false
}
