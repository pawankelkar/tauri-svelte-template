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
  {#snippet leading()}
    <div class="flex items-center pl-2">
      {#if leftActions}
        {@render leftActions()}
      {/if}
    </div>
  {/snippet}

  {#snippet trailing()}
    <div class="flex items-center pr-2">
      {#if rightActions}
        {@render rightActions()}
      {/if}
    </div>
  {/snippet}
</TitleBarShell>
