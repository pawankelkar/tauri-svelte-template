<script lang="ts">
  import type { Snippet } from 'svelte'
  import { getPlatform, type AppPlatform } from '$lib/hooks/use-platform.svelte'
  import MacTitleBar from './MacTitleBar.svelte'
  import WindowsTitleBar from './WindowsTitleBar.svelte'
  import LinuxTitleBar from './LinuxTitleBar.svelte'

  let {
    title,
    forcePlatform,
    leftActions,
    rightActions,
  }: {
    title?: string
    forcePlatform?: AppPlatform
    leftActions?: Snippet
    rightActions?: Snippet
  } = $props()

  const platform = $derived(
    import.meta.env.DEV && forcePlatform ? forcePlatform : getPlatform(),
  )
</script>

{#if platform === 'linux'}
  <LinuxTitleBar {title} {leftActions} {rightActions} />
{:else if platform === 'windows'}
  <WindowsTitleBar {title} {leftActions} {rightActions} />
{:else}
  <MacTitleBar {title} {leftActions} {rightActions} />
{/if}
