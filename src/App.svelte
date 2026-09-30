<script lang="ts">
  import { onMount } from 'svelte'
  import { listen } from '@tauri-apps/api/event'
  import { getCurrentWindow } from '@tauri-apps/api/window'
  import { commands, unwrapResult } from '$lib/tauri-bindings'
  import { initSquareCorners } from '$lib/stores/square-corners.svelte'
  import { initPreferences } from '$lib/stores/preferences.svelte'
  import { initNetwork } from '$lib/stores/network.svelte'
  import { initEntitlements } from '$lib/stores/entitlements.svelte'
  import { getAppState, initAppState } from '$lib/stores/app-state.svelte'
  import { openOnboardingDialog } from '$lib/commands/onboarding-dialog-state.svelte'
  import {
    confirmQuitIfDirty,
    flushAllStores,
    requestQuit,
  } from '$lib/lifecycle'
  import { initQuickPaneBridge } from '$lib/quick-pane/bridge'
  import { registerDeepLinkSchemeInDev } from '$lib/deep-link'
  import { toast } from '$lib/stores/toast'
  import {
    getSquareCorners,
    toggleLeftSidebar,
    toggleRightSidebar,
    isLeftSidebarVisible,
    isRightSidebarVisible,
  } from '$lib/stores/ui.svelte'
  import { initTheme, reconcileTheme } from '$lib/stores/theme.svelte'
  import { applyWindowEffects } from '$lib/theme/window-effects'
  import { initializeLanguage } from '$lib/i18n/language-init'
  import { initCommands } from '$lib/commands'
  import { getPlatform } from '$lib/hooks/use-platform.svelte'
  import { initBrowserKeySuppression } from '$lib/browser-keys'
  import { logger } from '$lib/logger'
  import PanelLeftCloseIcon from '@lucide/svelte/icons/panel-left-close'
  import PanelLeftOpenIcon from '@lucide/svelte/icons/panel-left-open'
  import PanelRightCloseIcon from '@lucide/svelte/icons/panel-right-close'
  import PanelRightOpenIcon from '@lucide/svelte/icons/panel-right-open'
  import { Button } from '$lib/components/ui/button'
  import TitleBar from '$lib/components/layout/TitleBar.svelte'
  import CommandPalette from '$lib/components/command-palette/CommandPalette.svelte'
  import PreferencesDialog from '$lib/components/preferences/PreferencesDialog.svelte'
  import OnboardingDialog from '$lib/components/onboarding/OnboardingDialog.svelte'
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte'
  import ToastContainer from '$lib/components/ToastContainer.svelte'
  import ErrorBoundary from '$lib/components/ErrorBoundary.svelte'
  import MainLayout from '$lib/components/layout/MainLayout.svelte'
  import EditorArea from '$lib/components/workspace/EditorArea.svelte'
  import { initTabs } from '$lib/workspace/tabs.svelte'
  import { routeDeepLink } from '$lib/workspace/deep-link-router'
  import { registerNoteView } from '$lib/workspace/note-view'
  import { initHistory } from '$lib/workspace/history.svelte'
  import { initVault } from '$lib/stores/vault.svelte'
  import { initNotes } from '$lib/stores/notes.svelte'
  import { initTreeState } from '$lib/stores/tree-state.svelte'
  import LeftSidebarPanel from '$lib/components/sidebar/LeftSidebarPanel.svelte'
  import RightSidebarPanel from '$lib/components/sidebar/RightSidebarPanel.svelte'
  import QuickOpen from '$lib/components/quick-open/QuickOpen.svelte'
  import CreateVaultDialog from '$lib/components/vault/CreateVaultDialog.svelte'
  import VaultSwitcher from '$lib/components/vault/VaultSwitcher.svelte'
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

  async function checkForRecentCrash(): Promise<void> {
    try {
      const result = unwrapResult(await commands.hasRecentCrash())
      if (!result) return
      const report = unwrapResult(
        await commands.getCrashReport(result.filename),
      )
      toast.warning(t('crash.recoveredMessage'), {
        duration: 10000,
        action: {
          label: t('crash.copyReport'),
          onClick: () => {
            void navigator.clipboard.writeText(report)
          },
        },
      })
    } catch {
      // Silent — crash detection is best-effort
    }
  }

  onMount(() => {
    const cleanupCorners = initSquareCorners()
    const cleanupTheme = initTheme()
    const cleanupQuickPane = initQuickPaneBridge()
    // Both mirror Rust state and publish the `offline` / `pro` context keys;
    // they start pessimistic (offline, no Pro) until the first load lands.
    const cleanupNetwork = initNetwork()
    const cleanupEntitlements = initEntitlements()
    const cleanupBrowserKeys = initBrowserKeySuppression(getPlatform(), {
      reload: true,
    })
    const unregisterNoteView = registerNoteView()
    // Before the vault store, which announces the reopened vault to it.
    const cleanupTreeState = initTreeState()

    if (import.meta.env.PROD) {
      window.addEventListener('contextmenu', suppressContextMenu)
    }
    let cleanupCommands: (() => void) | undefined
    let unlistenClose: (() => void) | undefined
    let unlistenTrayQuit: (() => void) | undefined
    let unlistenDeepLink: (() => void) | undefined
    let cleanupVault: (() => void) | undefined
    let cleanupNotes: (() => void) | undefined
    let cleanupHistory: (() => void) | undefined
    let destroyed = false

    const appWindow = getCurrentWindow()

    // Reopens the last vault; the notes store then closes any note tab
    // restored for a vault that could not be reopened.
    async function startVault(lastVaultId: string | null): Promise<void> {
      const vaultCleanup = await initVault(lastVaultId)
      if (destroyed) {
        vaultCleanup()
        return
      }
      cleanupVault = vaultCleanup
      cleanupNotes = initNotes()
    }

    void (async () => {
      // Register the close listener before showing the window so the user
      // can never click X before the handler exists. The flush failure is
      // swallowed on purpose: losing a debounced write is better than a
      // window that refuses to close.
      const unlisten = await listen<{ hide: boolean }>(
        'app:close-requested',
        async (event) => {
          if (!(await confirmQuitIfDirty())) return
          try {
            await flushAllStores()
          } catch (e) {
            logger.error('Flushing stores on close failed', e)
          }
          if (event.payload.hide) {
            await appWindow.hide()
            return
          }
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

      // Tray "Quit" reuses the palette's flush-then-quit path wholesale, so
      // stores are flushed before the process ends.
      const unlistenTray = await listen('tray:quit-requested', () => {
        void requestQuit()
      })
      if (destroyed) {
        unlistenTray()
        return
      }
      unlistenTrayQuit = unlistenTray

      // Route each `ostralith://` URL (notes and views open tabs) and come
      // forward. A link that arrives before `initTabs` below is kept: the
      // tabs store merges it into the restored strip.
      const unlistenDeep = await listen<string[]>(
        'app:deep-link-received',
        (event) => {
          for (const url of event.payload) routeDeepLink(url)
          void appWindow.unminimize()
          void appWindow.setFocus()
        },
      )
      if (destroyed) {
        unlistenDeep()
        return
      }
      unlistenDeepLink = unlistenDeep

      try {
        const [prefs, appState] = await Promise.all([
          initPreferences(),
          initAppState(),
        ])
        reconcileTheme()
        // Before show() so a vibrancy user never sees an opaque→translucent
        // pop. The CSS side is already painted via the paint hint.
        await applyWindowEffects(prefs.windowEffects)
        await initializeLanguage(prefs.language)
        // Runs the one-time keymap migration, whose toast needs both the
        // loaded preferences and the language set up above.
        if (!destroyed) cleanupCommands = initCommands()
        // After the commands so a restore problem can never leave the app
        // without its keyboard shortcuts.
        initTabs(appState)
        if (!destroyed) cleanupHistory = initHistory()
        // Not awaited: reopening the vault can wait on the OS keychain, and
        // the window must not stay hidden behind that prompt.
        void startVault(appState.lastVaultId)
        // Before show() so the first frame the user ever sees already has
        // the greeting up — no post-boot pop-in.
        if (!destroyed && !getAppState().onboardingCompleted) {
          openOnboardingDialog()
        }
        void registerDeepLinkSchemeInDev()
        void commands.cleanupOldRecoveryFiles()
        void checkForRecentCrash()
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
      cleanupBrowserKeys()
      cleanupCorners()
      cleanupTheme()
      cleanupQuickPane()
      cleanupNetwork()
      cleanupEntitlements()
      cleanupCommands?.()
      cleanupHistory?.()
      cleanupNotes?.()
      cleanupVault?.()
      cleanupTreeState()
      unregisterNoteView()
      unlistenClose?.()
      unlistenTrayQuit?.()
      unlistenDeepLink?.()
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
  <OnboardingDialog />
  <QuickOpen />
  <CreateVaultDialog />
  <VaultSwitcher />
  <ConfirmDialog />
  <ToastContainer />
  <main class="bg-background flex-1 overflow-hidden">
    <ErrorBoundary>
      <MainLayout>
        {#snippet left()}
          <LeftSidebarPanel />
        {/snippet}
        {#snippet right()}
          <RightSidebarPanel />
        {/snippet}
        <EditorArea />
      </MainLayout>
    </ErrorBoundary>
  </main>
</div>
