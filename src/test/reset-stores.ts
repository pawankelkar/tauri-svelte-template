import { __resetPreferencesForTests } from '$lib/stores/preferences.svelte'
import { THEME_STORAGE_KEY } from '$lib/theme/paint-hint'

export function resetAllStores(): void {
  __resetPreferencesForTests()
  localStorage.removeItem(THEME_STORAGE_KEY)
  // Phase 3: reset app-state/ui store
}
