import { __resetPreferencesForTests } from '$lib/stores/preferences.svelte'
import { __resetAppStateForTests } from '$lib/stores/app-state.svelte'
import { __resetConfirmForTests } from '$lib/stores/confirm.svelte'
import { __resetPreferencesDialogStateForTests } from '$lib/commands/preferences-dialog-state.svelte'
import { __resetPaletteStateForTests } from '$lib/commands/palette-state.svelte'
import { __resetPlatformCache } from '$lib/hooks/use-platform.svelte'
import { __resetTabsForTests } from '$lib/workspace/tabs.svelte'
import { __resetHistoryForTests } from '$lib/workspace/history.svelte'
import { __resetRenameRequestsForTests } from '$lib/workspace/rename-requests.svelte'
import { __resetVaultForTests } from '$lib/stores/vault.svelte'
import { __resetNotesForTests } from '$lib/stores/notes.svelte'
import { __resetTreeStateForTests } from '$lib/stores/tree-state.svelte'
import { __resetSidebarForTests } from '$lib/stores/sidebar.svelte'
import { __resetOverlaysForTests } from '$lib/stores/overlays.svelte'
import { __resetEditorRegistryForTests } from '$lib/editor/editor-registry.svelte'
import { __resetLinkCacheForTests } from '$lib/editor/link-cache'
import { resetContextKeys } from '$lib/commands/context-keys.svelte'
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

/** Resets the vault, notes and workspace stores the P1 features share. */
export function resetVaultStores(): void {
  __resetNotesForTests()
  __resetVaultForTests()
  __resetTabsForTests()
  __resetHistoryForTests()
  __resetRenameRequestsForTests()
  __resetTreeStateForTests()
  __resetSidebarForTests()
  __resetOverlaysForTests()
  __resetEditorRegistryForTests()
  __resetLinkCacheForTests()
  resetContextKeys()
  localStorage.clear()
}
