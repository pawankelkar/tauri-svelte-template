<script lang="ts">
  import EditorGroup from './EditorGroup.svelte'
  import EmptyWorkspace from './EmptyWorkspace.svelte'
  import { getGroups, getTabCount } from '$lib/workspace/tabs.svelte'
</script>

<!--
  The centre of the window. Groups sit side by side so splits can arrive
  without touching the layout; today there is only ever one.
-->
{#if getTabCount() === 0}
  <EmptyWorkspace />
{:else}
  <div class="flex h-full min-h-0 w-full">
    {#each getGroups() as group (group.id)}
      <div class="min-w-0 flex-1">
        <EditorGroup {group} />
      </div>
    {/each}
  </div>
{/if}
