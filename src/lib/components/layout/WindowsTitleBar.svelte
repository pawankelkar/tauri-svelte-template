<script lang="ts">
  import type { Snippet } from 'svelte'
  import { getCurrentWindow } from '@tauri-apps/api/window'
  import { cn } from '$lib/utils'
  import TitleBarShell from './TitleBarShell.svelte'

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

  const btnClass = 'flex h-8 w-12 items-center justify-center transition-colors'
</script>

<TitleBarShell {title}>
  <!--
    `data-tauri-drag-region="false"` + `self-stretch` on both clusters: the
    buttons are shorter than the bar, so without this the sliver of bar above
    and below them is a live drag region — a fast second click that drifts a
    few pixels off a button counts as a titlebar double-click and maximizes
    the window.
  -->
  {#snippet leading()}
    <div
      data-tauri-drag-region="false"
      class="flex items-center self-stretch pl-2"
    >
      {#if leftActions}
        {@render leftActions()}
      {/if}
    </div>
  {/snippet}

  {#snippet trailing()}
    <div data-tauri-drag-region="false" class="flex items-center self-stretch">
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
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
            >
              <path d="M2 0.5h7.5v7.5" stroke-width="1" />
              <rect x="0.5" y="2.5" width="7" height="7" stroke-width="1" />
            </svg>
          {:else}
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
            >
              <rect x="0.5" y="0.5" width="9" height="9" stroke-width="1" />
            </svg>
          {/if}
        </button>
        <button
          type="button"
          onclick={() => appWindow.close()}
          class={cn(
            btnClass,
            'hover:bg-destructive hover:text-destructive-foreground',
          )}
          aria-label="Close window"
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
          >
            <path d="M0 0L10 10M10 0L0 10" stroke-width="1" />
          </svg>
        </button>
      </div>
    </div>
  {/snippet}
</TitleBarShell>
