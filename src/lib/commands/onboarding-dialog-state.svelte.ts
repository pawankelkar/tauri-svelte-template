// Mirrors preferences-dialog-state.svelte.ts, minus the pane id — onboarding
// is a single-pane, effectively one-shot dialog. Kept as its own module (not
// merged into the preferences state) because the lifecycles differ: this one
// is opened by the boot sequence and never reopened once completed.

let _open = $state(false)

export function isOnboardingDialogOpen(): boolean {
  return _open
}

export function openOnboardingDialog(): void {
  _open = true
}

export function closeOnboardingDialog(): void {
  _open = false
}

export function setOnboardingDialogOpen(open: boolean): void {
  _open = open
}

export function __resetOnboardingDialogStateForTests(): void {
  _open = false
}
