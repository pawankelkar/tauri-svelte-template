<script lang="ts">
  import TabBar from './TabBar.svelte'
  import { getTab, type EditorGroup } from '$lib/workspace/tabs.svelte'
  import { loadView } from '$lib/workspace/view-registry'

  let { group }: { group: EditorGroup } = $props()

  const activeTab = $derived(
    group.activeTabId ? getTab(group.activeTabId) : undefined,
  )
  const panelId = $derived(`editor-panel-${group.id}`)
</script>

<section class="flex h-full min-h-0 flex-col">
  <TabBar {group} {panelId} />
  <div
    id={panelId}
    role="tabpanel"
    aria-labelledby={activeTab ? `workspace-tab-${activeTab.id}` : undefined}
    class="bg-background min-h-0 flex-1 overflow-auto"
  >
    {#if activeTab}
      <!-- Keyed by tab, so each tab's view starts from fresh state. The
           loader is cached per kind; the pending branch is left empty so an
           already-loaded view never flashes a placeholder. -->
      {#key activeTab.id}
        {#await loadView(activeTab.kind) then View}
          <View tab={activeTab} groupId={group.id} />
        {/await}
      {/key}
    {/if}
  </div>
</section>
