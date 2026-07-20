import { __resetPreferencesForTests } from '$lib/stores/preferences.svelte'
import { __resetAppStateForTests } from '$lib/stores/app-state.svelte'
import { __resetConfirmForTests } from '$lib/stores/confirm.svelte'
import { __resetPreferencesDialogStateForTests } from '$lib/commands/preferences-dialog-state.svelte'
import { THEME_STORAGE_KEY } from '$lib/theme/paint-hint'

export function resetAllStores(): void {
  __resetPreferencesForTests()
  __resetAppStateForTests()
  __resetConfirmForTests()
  __resetPreferencesDialogStateForTests()
  localStorage.removeItem(THEME_STORAGE_KEY)
}
