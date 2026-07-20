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
  import { initCommands } from '$lib/commands'
  import TitleBar from '$lib/components/layout/TitleBar.svelte'
  import CommandPalette from '$lib/components/command-palette/CommandPalette.svelte'
  import PreferencesDialog from '$lib/components/preferences/PreferencesDialog.svelte'
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte'
  import ToastContainer from '$lib/components/ToastContainer.svelte'
  import ErrorBoundary from '$lib/components/ErrorBoundary.svelte'
  import MainLayout from '$lib/components/layout/MainLayout.svelte'
  import WelcomePane from '$lib/components/demo/WelcomePane.svelte'
  import { t } from '$lib/i18n/t.svelte'
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
    let cleanupCommands: (() => void) | undefined

    void (async () => {
      const [prefs] = await Promise.all([initPreferences(), initAppState()])
      reconcileTheme()
      await initializeLanguage(prefs.language)
      cleanupCommands = initCommands()
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
      cleanupCommands?.()
      unlistenClose.then((fn) => fn())
    }
  })
</script>

<div class="flex h-screen flex-col rounded-[var(--app-corner-radius)] overflow-hidden">
  <TitleBar />
  <!-- Global overlays live outside the boundary so they stay usable, and the
       window keeps its controls, even if the content area crashes. -->
  <CommandPalette />
  <PreferencesDialog />
  <ConfirmDialog />
  <ToastContainer />
  <main class="bg-background flex-1 overflow-hidden">
    <ErrorBoundary>
      <MainLayout>
        {#snippet left()}
          <div class="text-muted-foreground p-4 text-sm">
            {t('sidebar.leftPlaceholder')}
          </div>
        {/snippet}
        {#snippet right()}
          <div class="text-muted-foreground p-4 text-sm">
            {t('sidebar.rightPlaceholder')}
          </div>
        {/snippet}
        <WelcomePane />
      </MainLayout>
    </ErrorBoundary>
  </main>
</div>
