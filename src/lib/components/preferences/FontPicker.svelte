<script lang="ts">
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down'
  import * as Command from '$lib/components/ui/command'
  import { Button } from '$lib/components/ui/button'
  import { commands, unwrapResult } from '$lib/tauri-bindings'
  import { logger } from '$lib/logger'
  import { t } from '$lib/i18n/t.svelte'

  let {
    value,
    onValueChange,
  }: {
    /** Current family, or null for the system default stack. */
    value: string | null
    onValueChange: (family: string | null) => void
  } = $props()

  let open = $state(false)
  // null = not fetched yet; the OS font list is stable for the app's
  // lifetime, so one fetch on first open serves every reopen.
  let fonts = $state<string[] | null>(null)
  let loadFailed = $state(false)

  $effect(() => {
    if (!open || fonts !== null) return
    commands
      .listSystemFonts()
      .then((result) => {
        fonts = unwrapResult(result)
      })
      .catch((e: unknown) => {
        logger.error('Font enumeration failed', e)
        loadFailed = true
      })
  })

  function pick(family: string | null): void {
    onValueChange(family)
    open = false
  }
</script>

<Button
  variant="outline"
  size="sm"
  class="w-[240px] justify-between font-normal"
  onclick={() => (open = true)}
>
  <span class="truncate" style:font-family={value ? `'${value}'` : undefined}>
    {value ?? t('preferences.appearance.fontFamilySystemOption')}
  </span>
  <ChevronDownIcon class="text-muted-foreground size-4 shrink-0" />
</Button>

<Command.Dialog
  {open}
  onOpenChange={(v) => (open = v)}
  title={t('preferences.appearance.fontFamilyLabel')}
>
  <Command.Input
    placeholder={t('preferences.appearance.fontFamilySearchPlaceholder')}
  />
  <Command.List>
    {#if fonts === null}
      <Command.Loading>
        {t(
          loadFailed
            ? 'preferences.appearance.fontFamilyLoadFailed'
            : 'preferences.appearance.fontFamilyLoading',
        )}
      </Command.Loading>
    {:else}
      <Command.Empty>
        {t('preferences.appearance.fontFamilyNoMatches')}
      </Command.Empty>
      <Command.Item
        value={t('preferences.appearance.fontFamilySystemOption')}
        onSelect={() => pick(null)}
      >
        {t('preferences.appearance.fontFamilySystemOption')}
      </Command.Item>
      {#each fonts as family (family)}
        <Command.Item value={family} onSelect={() => pick(family)}>
          <!-- Each row renders in its own face — a live preview, and any
               family the webview cannot resolve visibly falls back. -->
          <span style:font-family={`'${family}'`}>{family}</span>
        </Command.Item>
      {/each}
    {/if}
  </Command.List>
</Command.Dialog>
