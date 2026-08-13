<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog'
  import { Button } from '$lib/components/ui/button'
  import { Kbd } from '$lib/components/ui/kbd'
  import CommandIcon from '@lucide/svelte/icons/command'
  import Settings2Icon from '@lucide/svelte/icons/settings-2'
  import ZapIcon from '@lucide/svelte/icons/zap'
  import {
    isOnboardingDialogOpen,
    closeOnboardingDialog,
  } from '$lib/commands/onboarding-dialog-state.svelte'
  import { completeOnboarding } from '$lib/stores/app-state.svelte'
  import { getPreferences } from '$lib/stores/preferences.svelte'
  import { getPlatform } from '$lib/hooks/use-platform.svelte'
  import { formatShortcut } from '$lib/platform-strings'
  import { fromTauriAccelerator } from '$lib/shortcuts'
  import { t } from '$lib/i18n/t.svelte'

  const paletteShortcut = $derived(formatShortcut(getPlatform(), 'k', ['mod']))

  // The Quick Pane accelerator is stored as a Tauri accelerator string; a
  // cleared binding shows the row without a chip rather than a stale default.
  const quickPaneShortcut = $derived.by(() => {
    const accelerator = getPreferences().quickPaneShortcut
    if (!accelerator) return null
    const { key, modifiers } = fromTauriAccelerator(accelerator)
    return key ? formatShortcut(getPlatform(), key, modifiers) : null
  })

  // Every dismissal path — button, Escape, overlay click — marks onboarding
  // complete. Forgiving semantics: the dialog is a greeting, not a gate, and
  // must never reappear on the next launch.
  function handleOpenChange(open: boolean): void {
    if (!open) {
      completeOnboarding()
      closeOnboardingDialog()
    }
  }

  function handleGetStarted(): void {
    completeOnboarding()
    closeOnboardingDialog()
  }

  const HIGHLIGHTS = [
    {
      icon: CommandIcon,
      titleKey: 'onboarding.highlightPaletteTitle',
      bodyKey: 'onboarding.highlightPaletteBody',
      shortcut: () => paletteShortcut,
    },
    {
      icon: Settings2Icon,
      titleKey: 'onboarding.highlightPreferencesTitle',
      bodyKey: 'onboarding.highlightPreferencesBody',
      shortcut: () => null,
    },
    {
      icon: ZapIcon,
      titleKey: 'onboarding.highlightQuickPaneTitle',
      bodyKey: 'onboarding.highlightQuickPaneBody',
      shortcut: () => quickPaneShortcut,
    },
  ]
</script>

<Dialog.Root open={isOnboardingDialogOpen()} onOpenChange={handleOpenChange}>
  <Dialog.Content class="max-w-md">
    <Dialog.Title class="sr-only">{t('onboarding.title')}</Dialog.Title>
    <Dialog.Description class="sr-only">
      {t('onboarding.description')}
    </Dialog.Description>

    <div class="space-y-1">
      <h2 class="text-lg font-semibold">{t('onboarding.welcomeHeading')}</h2>
      <p class="text-muted-foreground text-sm">
        {t('onboarding.welcomeBody')}
      </p>
    </div>

    <div class="space-y-3 py-2">
      {#each HIGHLIGHTS as highlight (highlight.titleKey)}
        <div class="flex items-start gap-3">
          <div class="bg-muted mt-0.5 rounded-md p-2">
            <highlight.icon class="size-4" />
          </div>
          <div class="min-w-0 flex-1 space-y-0.5">
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium">{t(highlight.titleKey)}</span>
              {#if highlight.shortcut()}
                <Kbd>{highlight.shortcut()}</Kbd>
              {/if}
            </div>
            <p class="text-muted-foreground text-sm">{t(highlight.bodyKey)}</p>
          </div>
        </div>
      {/each}
    </div>

    <Button class="w-full" onclick={handleGetStarted}>
      {t('onboarding.getStarted')}
    </Button>
  </Dialog.Content>
</Dialog.Root>
