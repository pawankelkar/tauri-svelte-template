<script lang="ts">
  import type { Snippet } from 'svelte'
  import TitleBarShell from './TitleBarShell.svelte'

  /**
   * Linux keeps whatever window controls the compositor draws, so this variant
   * is the bare shell: actions on either side and nothing else.
   */

  let {
    title,
    leftActions,
    rightActions,
  }: {
    title?: string
    leftActions?: Snippet
    rightActions?: Snippet
  } = $props()
</script>

<TitleBarShell {title}>
  <!-- drag-region="false" + self-stretch: see WindowsTitleBar.svelte. -->
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
    <div
      data-tauri-drag-region="false"
      class="flex items-center self-stretch pr-2"
    >
      {#if rightActions}
        {@render rightActions()}
      {/if}
    </div>
  {/snippet}
</TitleBarShell>
