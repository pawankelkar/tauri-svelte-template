export type PreferencesPaneId =
  'general' | 'appearance' | 'shortcuts' | 'advanced'

let _open = $state(false)
let _activePane = $state<PreferencesPaneId>('general')

export function isPreferencesDialogOpen(): boolean {
  return _open
}

export function getActivePreferencesPane(): PreferencesPaneId {
  return _activePane
}

export function setActivePreferencesPane(pane: PreferencesPaneId): void {
  _activePane = pane
}

export function openPreferencesDialog(pane?: PreferencesPaneId): void {
  if (pane) _activePane = pane
  _open = true
}

export function closePreferencesDialog(): void {
  _open = false
}

export function setPreferencesDialogOpen(open: boolean): void {
  _open = open
}

export function __resetPreferencesDialogStateForTests(): void {
  _open = false
  _activePane = 'general'
}
