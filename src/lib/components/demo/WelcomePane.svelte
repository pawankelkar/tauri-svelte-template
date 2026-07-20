<script lang="ts">
  import * as Card from '$lib/components/ui/card'
  import { Button } from '$lib/components/ui/button'
  import {
    executeCommand,
    getCommand,
    demoRelaunchApp,
    OPEN_COMMAND_PALETTE,
    OPEN_PREFERENCES,
    TOGGLE_THEME,
    TOGGLE_LEFT_SIDEBAR,
    TOGGLE_RIGHT_SIDEBAR,
    TOGGLE_QUICK_PANE,
    DEMO_SEND_NOTIFICATION,
    DEMO_COPY_TO_CLIPBOARD,
    DEMO_PASTE_FROM_CLIPBOARD,
    DEMO_OPEN_FILE_DIALOG,
    DEMO_RUN_SHELL_COMMAND,
  } from '$lib/commands'
  import { toast } from '$lib/stores/toast'
  import { confirm } from '$lib/stores/confirm.svelte'
  import { getLastQuickPaneEntry } from '$lib/stores/ui.svelte'
  import { getPreferences } from '$lib/stores/preferences.svelte'
  import { fromTauriAccelerator } from '$lib/shortcuts'
  import { commands, unwrapResult } from '$lib/tauri-bindings'
  import { parseShortcut } from '$lib/shortcuts'
  import { formatShortcut } from '$lib/platform-strings'
  import { getPlatform } from '$lib/hooks/use-platform.svelte'
  import { t } from '$lib/i18n/t.svelte'

  /**
   * This whole component is the template's demo surface: every tile documents a
   * feature and triggers it, so it doubles as a manual smoke test. Delete
   * src/lib/components/demo/ when you start your own app.
   */

  // A crash has to originate in render or an effect — <svelte:boundary> does
  // not catch throws from event handlers. Flipping state and throwing from an
  // $effect is what actually reaches ErrorBoundary.
  let crash = $state(false)
  $effect(() => {
    if (crash) throw new Error('Demo crash triggered from WelcomePane')
  })

  function shortcutFor(commandId: string): string | null {
    const shortcut = getCommand(commandId)?.shortcut
    if (!shortcut) return null
    const { key, modifiers } = parseShortcut(shortcut)
    return formatShortcut(getPlatform(), key, modifiers)
  }

  /**
   * The Quick Pane's binding lives in preferences, not the command registry —
   * it is an OS-level accelerator, so it works even when this window is not
   * focused, and the user can rebind it.
   */
  const quickPaneShortcut = $derived.by(() => {
    const accelerator = getPreferences().quickPaneShortcut
    if (!accelerator) return null
    const { key, modifiers } = fromTauriAccelerator(accelerator)
    return formatShortcut(getPlatform(), key, modifiers)
  })

  async function confirmDemo(): Promise<void> {
    const confirmed = await confirm({
      titleKey: 'welcome.confirm.title',
      descriptionKey: 'welcome.confirm.description',
      confirmKey: 'welcome.confirm.action',
      destructive: true,
    })
    if (confirmed) {
      toast.success(t('welcome.confirm.confirmed'))
    } else {
      toast.message(t('welcome.confirm.cancelled'))
    }
  }

  function actionToastDemo(): void {
    toast.success(t('welcome.toast.withActionMessage'), {
      action: {
        label: t('welcome.toast.undo'),
        onClick: () => toast.message(t('welcome.toast.undone')),
      },
    })
  }

  async function greetDemo(): Promise<void> {
    try {
      const greeting = unwrapResult(await commands.greet('Svelte'))
      toast.success(greeting)
    } catch {
      toast.error(t('welcome.greetFailed'))
    }
  }

  interface Tile {
    titleKey: string
    descriptionKey: string
    actionKey: string
    shortcut?: string | null
    /** Extra live text under the description — used to show received data. */
    detail?: string | null
    run: () => void | Promise<void>
    variant?: 'default' | 'outline' | 'destructive'
  }

  const tiles: Tile[] = [
    {
      titleKey: 'welcome.tiles.palette.title',
      descriptionKey: 'welcome.tiles.palette.description',
      actionKey: 'welcome.tiles.palette.action',
      get shortcut() {
        return shortcutFor(OPEN_COMMAND_PALETTE)
      },
      run: () => void executeCommand(OPEN_COMMAND_PALETTE),
    },
    {
      titleKey: 'welcome.tiles.preferences.title',
      descriptionKey: 'welcome.tiles.preferences.description',
      actionKey: 'welcome.tiles.preferences.action',
      get shortcut() {
        return shortcutFor(OPEN_PREFERENCES)
      },
      run: () => void executeCommand(OPEN_PREFERENCES),
    },
    {
      titleKey: 'welcome.tiles.theme.title',
      descriptionKey: 'welcome.tiles.theme.description',
      actionKey: 'welcome.tiles.theme.action',
      run: () => void executeCommand(TOGGLE_THEME),
    },
    {
      titleKey: 'welcome.tiles.sidebars.title',
      descriptionKey: 'welcome.tiles.sidebars.description',
      actionKey: 'welcome.tiles.sidebars.action',
      get shortcut() {
        return shortcutFor(TOGGLE_LEFT_SIDEBAR)
      },
      run: () => void executeCommand(TOGGLE_LEFT_SIDEBAR),
    },
    {
      titleKey: 'welcome.tiles.rightSidebar.title',
      descriptionKey: 'welcome.tiles.rightSidebar.description',
      actionKey: 'welcome.tiles.rightSidebar.action',
      get shortcut() {
        return shortcutFor(TOGGLE_RIGHT_SIDEBAR)
      },
      run: () => void executeCommand(TOGGLE_RIGHT_SIDEBAR),
    },
    {
      titleKey: 'welcome.tiles.quickPane.title',
      descriptionKey: 'welcome.tiles.quickPane.description',
      actionKey: 'welcome.tiles.quickPane.action',
      get shortcut() {
        return quickPaneShortcut
      },
      get detail() {
        const entry = getLastQuickPaneEntry()
        return entry
          ? t('welcome.tiles.quickPane.lastEntry', { text: entry })
          : null
      },
      run: () => void executeCommand(TOGGLE_QUICK_PANE),
    },
    {
      titleKey: 'welcome.tiles.toast.title',
      descriptionKey: 'welcome.tiles.toast.description',
      actionKey: 'welcome.tiles.toast.action',
      run: () => {
        toast.success(t('welcome.toast.message'))
      },
    },
    {
      titleKey: 'welcome.tiles.toastAction.title',
      descriptionKey: 'welcome.tiles.toastAction.description',
      actionKey: 'welcome.tiles.toastAction.action',
      run: actionToastDemo,
    },
    {
      titleKey: 'welcome.tiles.confirm.title',
      descriptionKey: 'welcome.tiles.confirm.description',
      actionKey: 'welcome.tiles.confirm.action',
      run: confirmDemo,
    },
    {
      titleKey: 'welcome.tiles.notification.title',
      descriptionKey: 'welcome.tiles.notification.description',
      actionKey: 'welcome.tiles.notification.action',
      run: () => void executeCommand(DEMO_SEND_NOTIFICATION),
    },
    {
      titleKey: 'welcome.tiles.clipboardCopy.title',
      descriptionKey: 'welcome.tiles.clipboardCopy.description',
      actionKey: 'welcome.tiles.clipboardCopy.action',
      run: () => void executeCommand(DEMO_COPY_TO_CLIPBOARD),
    },
    {
      titleKey: 'welcome.tiles.clipboardRead.title',
      descriptionKey: 'welcome.tiles.clipboardRead.description',
      actionKey: 'welcome.tiles.clipboardRead.action',
      run: () => void executeCommand(DEMO_PASTE_FROM_CLIPBOARD),
    },
    {
      titleKey: 'welcome.tiles.fileDialog.title',
      descriptionKey: 'welcome.tiles.fileDialog.description',
      actionKey: 'welcome.tiles.fileDialog.action',
      run: () => void executeCommand(DEMO_OPEN_FILE_DIALOG),
    },
    {
      titleKey: 'welcome.tiles.shell.title',
      descriptionKey: 'welcome.tiles.shell.description',
      actionKey: 'welcome.tiles.shell.action',
      run: () => void executeCommand(DEMO_RUN_SHELL_COMMAND),
    },
    {
      titleKey: 'welcome.tiles.greet.title',
      descriptionKey: 'welcome.tiles.greet.description',
      actionKey: 'welcome.tiles.greet.action',
      run: greetDemo,
    },
    {
      titleKey: 'welcome.tiles.relaunch.title',
      descriptionKey: 'welcome.tiles.relaunch.description',
      actionKey: 'welcome.tiles.relaunch.action',
      run: demoRelaunchApp,
      variant: 'destructive',
    },
    {
      titleKey: 'welcome.tiles.crash.title',
      descriptionKey: 'welcome.tiles.crash.description',
      actionKey: 'welcome.tiles.crash.action',
      run: () => {
        crash = true
      },
      variant: 'destructive',
    },
  ]
</script>

<div class="h-full overflow-auto">
  <div class="mx-auto flex max-w-5xl flex-col gap-6 p-8">
    <header class="space-y-1">
      <h1 class="text-2xl font-semibold tracking-tight">
        {t('welcome.title')}
      </h1>
      <p class="text-muted-foreground text-sm">{t('welcome.subtitle')}</p>
    </header>

    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {#each tiles as tile (tile.titleKey)}
        <Card.Root class="flex flex-col">
          <Card.Header>
            <Card.Title
              class="flex items-center justify-between gap-2 text-base"
            >
              <span>{t(tile.titleKey)}</span>
              {#if tile.shortcut}
                <kbd
                  class="bg-muted text-muted-foreground rounded px-1.5 py-0.5 font-mono text-xs"
                >
                  {tile.shortcut}
                </kbd>
              {/if}
            </Card.Title>
            <Card.Description>{t(tile.descriptionKey)}</Card.Description>
            {#if tile.detail}
              <p class="text-foreground truncate text-sm font-medium">
                {tile.detail}
              </p>
            {/if}
          </Card.Header>
          <Card.Footer class="mt-auto">
            <Button
              variant={tile.variant ?? 'outline'}
              size="sm"
              onclick={() => void tile.run()}
            >
              {t(tile.actionKey)}
            </Button>
          </Card.Footer>
        </Card.Root>
      {/each}
    </div>
  </div>
</div>
