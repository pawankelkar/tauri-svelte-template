<script lang="ts">
  import type { Snippet } from 'svelte'
  import { t } from '$lib/i18n/t.svelte'

  let {
    title,
    leftActions,
    rightActions,
  }: {
    title?: string
    leftActions?: Snippet
    rightActions?: Snippet
  } = $props()

  const displayTitle = $derived(title ?? t('titlebar.default'))
</script>

<div
  data-tauri-drag-region
  class="relative flex h-8 w-full shrink-0 items-center justify-between border-b bg-background"
>
  <!-- Left side -->
  <div class="flex items-center pl-2">
    {#if leftActions}
      {@render leftActions()}
    {/if}
  </div>

  <!-- Center title -->
  <div
    data-tauri-drag-region
    class="pointer-events-none absolute inset-0 flex items-center justify-center"
  >
    <span class="text-xs font-medium text-muted-foreground">{displayTitle}</span>
  </div>

  <!-- Right side -->
  <div class="flex items-center pr-2">
    {#if rightActions}
      {@render rightActions()}
    {/if}
  </div>
</div>
