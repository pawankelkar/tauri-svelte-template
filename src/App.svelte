<script lang="ts">
  import { onMount } from 'svelte'
  import { listen } from '@tauri-apps/api/event'
  import { invoke } from '@tauri-apps/api/core'
  import { getCurrentWindow } from '@tauri-apps/api/window'
  import { initSquareCorners } from '$lib/stores/square-corners.svelte'
  import {
    initPreferences,
    persistPreferencesNow,
  } from '$lib/stores/preferences.svelte'
  import {
    initAppState,
    persistAppStateNow,
  } from '$lib/stores/app-state.svelte'
  import { getSquareCorners } from '$lib/stores/ui.svelte'
  import { initTheme, reconcileTheme } from '$lib/stores/theme.svelte'
  import { initializeLanguage } from '$lib/i18n/language-init'
  import TitleBar from '$lib/components/layout/TitleBar.svelte'
  import './app.css'

  $effect(() => {
    document.documentElement.classList.toggle(
      'square-corners',
      getSquareCorners(),
    )
  })

  onMount(() => {
    const cleanupCorners = initSquareCorners()
    const cleanupTheme = initTheme()

    void (async () => {
      const [prefs] = await Promise.all([initPreferences(), initAppState()])
      reconcileTheme()
      await initializeLanguage(prefs.language)
    })()

    const appWindow = getCurrentWindow()
    appWindow.show()
    appWindow.setFocus()

    const unlistenClose = listen('app:close-requested', async () => {
      await Promise.all([persistPreferencesNow(), persistAppStateNow()])
      await invoke('confirm_close')
      appWindow.close()
    })

    return () => {
      cleanupCorners()
      cleanupTheme()
      unlistenClose.then((fn) => fn())
    }
  })
</script>

<div class="flex h-screen flex-col rounded-[var(--app-corner-radius)] overflow-hidden">
  <TitleBar />
  <main class="flex-1 overflow-auto bg-background">
    <!-- Phase 3+ layout content goes here -->
  </main>
</div>
