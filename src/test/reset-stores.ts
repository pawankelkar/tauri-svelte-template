import { __resetPreferencesForTests } from '$lib/stores/preferences.svelte'
import { __resetAppStateForTests } from '$lib/stores/app-state.svelte'
import { __resetConfirmForTests } from '$lib/stores/confirm.svelte'
import { __resetPreferencesDialogStateForTests } from '$lib/commands/preferences-dialog-state.svelte'
import { __resetPaletteStateForTests } from '$lib/commands/palette-state.svelte'
import { __resetPlatformCache } from '$lib/hooks/use-platform.svelte'
import { THEME_STORAGE_KEY, PAINT_HINT_KEY } from '$lib/theme/paint-hint'

export function resetAllStores(): void {
  __resetPreferencesForTests()
  __resetAppStateForTests()
  __resetConfirmForTests()
  __resetPreferencesDialogStateForTests()
  __resetPaletteStateForTests()
  __resetPlatformCache()
  localStorage.removeItem(THEME_STORAGE_KEY)
  localStorage.removeItem(PAINT_HINT_KEY)
}
