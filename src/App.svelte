<script lang="ts">
  import { onMount } from 'svelte'
  import { listen } from '@tauri-apps/api/event'
  import { getCurrentWindow } from '@tauri-apps/api/window'
  import { commands } from '$lib/tauri-bindings'
  import { initSquareCorners } from '$lib/stores/square-corners.svelte'
  import { initPreferences } from '$lib/stores/preferences.svelte'
  import { initAppState } from '$lib/stores/app-state.svelte'
  import { flushAllStores } from '$lib/lifecycle'
  import { initQuickPaneBridge } from '$lib/quick-pane/bridge'
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
    const cleanupQuickPane = initQuickPaneBridge()
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

    // Rust prevents the close and hands the decision back here, because only
    // the frontend can flush the debounced stores. `hide` carries the
    // platform's convention: macOS keeps the app running behind the dock.
    const unlistenClose = listen<{ hide: boolean }>(
      'app:close-requested',
      async (event) => {
        await flushAllStores()
        if (event.payload.hide) {
          await appWindow.hide()
          return
        }
        await commands.confirmClose()
        await appWindow.close()
      },
    )

    return () => {
      cleanupCorners()
      cleanupTheme()
      cleanupQuickPane()
      cleanupCommands?.()
      unlistenClose.then((fn) => fn())
    }
  })
</script>

<div
  class="flex h-screen flex-col rounded-[var(--app-corner-radius)] overflow-hidden"
>
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
