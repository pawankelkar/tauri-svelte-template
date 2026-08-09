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
  import {
    getSquareCorners,
    toggleLeftSidebar,
    toggleRightSidebar,
    isLeftSidebarVisible,
    isRightSidebarVisible,
  } from '$lib/stores/ui.svelte'
  import { initTheme, reconcileTheme } from '$lib/stores/theme.svelte'
  import { initializeLanguage } from '$lib/i18n/language-init'
  import { initCommands } from '$lib/commands'
  import { getPlatform } from '$lib/hooks/use-platform.svelte'
  import { logger } from '$lib/logger'
  import PanelLeftCloseIcon from '@lucide/svelte/icons/panel-left-close'
  import PanelLeftOpenIcon from '@lucide/svelte/icons/panel-left-open'
  import PanelRightCloseIcon from '@lucide/svelte/icons/panel-right-close'
  import PanelRightOpenIcon from '@lucide/svelte/icons/panel-right-open'
  import { Button } from '$lib/components/ui/button'
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

  $effect(() => {
    document.documentElement.classList.toggle(
      'platform-macos',
      getPlatform() === 'macos',
    )
  })

  // Production only: a stray right-click showing the webview's own menu
  // ("Reload", "Inspect"…) breaks the native illusion. Editable fields keep
  // their default menu unless a custom one is attached (see
  // `textInputContextMenu`), and dev keeps right-click → Inspect.
  function suppressContextMenu(e: MouseEvent): void {
    const target = e.target as HTMLElement | null
    if (target?.closest('input, textarea, [contenteditable="true"]')) return
    e.preventDefault()
  }

  onMount(() => {
    const cleanupCorners = initSquareCorners()
    const cleanupTheme = initTheme()
    const cleanupQuickPane = initQuickPaneBridge()

    if (import.meta.env.PROD) {
      window.addEventListener('contextmenu', suppressContextMenu)
    }
    let cleanupCommands: (() => void) | undefined
    let unlistenClose: (() => void) | undefined
    let destroyed = false

    const appWindow = getCurrentWindow()

    void (async () => {
      // Register the close listener before showing the window so the user
      // can never click X before the handler exists. The flush failure is
      // swallowed on purpose: losing a debounced write is better than a
      // window that refuses to close.
      const unlisten = await listen<{ hide: boolean }>(
        'app:close-requested',
        async (event) => {
          try {
            await flushAllStores()
          } catch (e) {
            logger.error('Flushing stores on close failed', e)
          }
          if (event.payload.hide) {
            await appWindow.hide()
            return
          }
          // Quit the whole app rather than closing this window: the hidden
          // Quick Pane window would otherwise keep the process alive after
          // the main window is gone.
          await commands.quitApp()
        },
      )
      // HMR can destroy this component while `listen` is still in flight;
      // an orphaned listener would double-run the close handshake.
      if (destroyed) {
        unlisten()
        return
      }
      unlistenClose = unlisten

      try {
        const [prefs] = await Promise.all([initPreferences(), initAppState()])
        reconcileTheme()
        await initializeLanguage(prefs.language)
        if (!destroyed) cleanupCommands = initCommands()
        void commands.cleanupOldRecoveryFiles()
      } finally {
        // Show even if an init step failed — a degraded UI beats a window
        // that never appears.
        appWindow.show()
        appWindow.setFocus()
      }
    })()

    return () => {
      destroyed = true
      window.removeEventListener('contextmenu', suppressContextMenu)
      cleanupCorners()
      cleanupTheme()
      cleanupQuickPane()
      cleanupCommands?.()
      unlistenClose?.()
    }
  })
</script>

<div
  class="flex h-screen flex-col rounded-[var(--app-corner-radius)] overflow-hidden"
>
  <TitleBar>
    {#snippet leftActions()}
      <Button
        variant="ghost"
        size="icon-sm"
        onclick={toggleLeftSidebar}
        aria-label={t(
          isLeftSidebarVisible()
            ? 'titlebar.hideLeftSidebar'
            : 'titlebar.showLeftSidebar',
        )}
      >
        {#if isLeftSidebarVisible()}
          <PanelLeftCloseIcon />
        {:else}
          <PanelLeftOpenIcon />
        {/if}
      </Button>
    {/snippet}
    {#snippet rightActions()}
      <Button
        variant="ghost"
        size="icon-sm"
        onclick={toggleRightSidebar}
        aria-label={t(
          isRightSidebarVisible()
            ? 'titlebar.hideRightSidebar'
            : 'titlebar.showRightSidebar',
        )}
      >
        {#if isRightSidebarVisible()}
          <PanelRightCloseIcon />
        {:else}
          <PanelRightOpenIcon />
        {/if}
      </Button>
    {/snippet}
  </TitleBar>
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
