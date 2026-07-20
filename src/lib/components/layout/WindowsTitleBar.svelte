<script lang="ts">
  import type { Snippet } from 'svelte'
  import { getCurrentWindow } from '@tauri-apps/api/window'
  import { cn } from '$lib/utils'
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

  const appWindow = getCurrentWindow()
  let isMaximized = $state(false)

  $effect(() => {
    appWindow.isMaximized().then((v) => {
      isMaximized = v
    })
    const p = appWindow.onResized(() => {
      appWindow.isMaximized().then((v) => {
        isMaximized = v
      })
    })
    return () => {
      p.then((unlisten) => unlisten())
    }
  })

  const displayTitle = $derived(title ?? t('titlebar.default'))
  const btnClass = 'flex h-8 w-12 items-center justify-center transition-colors'
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

  <!-- Right side: actions + window controls -->
  <div class="flex items-center">
    {#if rightActions}
      {@render rightActions()}
    {/if}
    <div class="flex">
      <button
        type="button"
        onclick={() => appWindow.minimize()}
        class={cn(btnClass, 'hover:bg-foreground/10')}
        aria-label="Minimize window"
      >
        <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor">
          <rect width="10" height="1" />
        </svg>
      </button>
      <button
        type="button"
        onclick={() => appWindow.toggleMaximize()}
        class={cn(btnClass, 'hover:bg-foreground/10')}
        aria-label={isMaximized ? 'Restore window' : 'Maximize window'}
      >
        {#if isMaximized}
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor">
            <path d="M2 0.5h7.5v7.5" stroke-width="1" />
            <rect x="0.5" y="2.5" width="7" height="7" stroke-width="1" />
          </svg>
        {:else}
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor">
            <rect x="0.5" y="0.5" width="9" height="9" stroke-width="1" />
          </svg>
        {/if}
      </button>
      <button
        type="button"
        onclick={() => appWindow.close()}
        class={cn(btnClass, 'hover:bg-destructive hover:text-destructive-foreground')}
        aria-label="Close window"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor">
          <path d="M0 0L10 10M10 0L0 10" stroke-width="1" />
        </svg>
      </button>
    </div>
  </div>
</div>
