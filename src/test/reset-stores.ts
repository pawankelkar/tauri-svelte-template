import { __resetPreferencesForTests } from '$lib/stores/preferences.svelte'
import { __resetAppStateForTests } from '$lib/stores/app-state.svelte'
import { THEME_STORAGE_KEY } from '$lib/theme/paint-hint'

export function resetAllStores(): void {
  __resetPreferencesForTests()
  __resetAppStateForTests()
  localStorage.removeItem(THEME_STORAGE_KEY)
}
