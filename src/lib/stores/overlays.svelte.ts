/**
 * Open/closed state of the vault-related overlays: quick open, the create
 * vault dialog and the vault switcher. Each lives in `App.svelte`; commands
 * and buttons flip these.
 */

let _quickOpen = $state(false)
let _createVault = $state(false)
let _vaultSwitcher = $state(false)

export function isQuickOpenOpen(): boolean {
  return _quickOpen
}

export function setQuickOpenOpen(open: boolean): void {
  _quickOpen = open
}

export function toggleQuickOpen(): void {
  _quickOpen = !_quickOpen
}

export function isCreateVaultOpen(): boolean {
  return _createVault
}

export function setCreateVaultOpen(open: boolean): void {
  _createVault = open
}

export function isVaultSwitcherOpen(): boolean {
  return _vaultSwitcher
}

export function setVaultSwitcherOpen(open: boolean): void {
  _vaultSwitcher = open
}

export function __resetOverlaysForTests(): void {
  _quickOpen = false
  _createVault = false
  _vaultSwitcher = false
}
