<script lang="ts">
  import ListTreeIcon from '@lucide/svelte/icons/list-tree'
  import LinkIcon from '@lucide/svelte/icons/link'
  import { Button } from '$lib/components/ui/button'
  import BacklinksPanel from './BacklinksPanel.svelte'
  import OutlinePanel from './OutlinePanel.svelte'
  import { getActiveTab } from '$lib/workspace/tabs.svelte'
  import { notePathOfTab } from '$lib/workspace/open-note'
  import {
    getRightPanel,
    setRightPanel,
    type RightPanel,
  } from '$lib/stores/sidebar.svelte'
  import { t } from '$lib/i18n/t.svelte'
  import { cn } from '$lib/utils'

  const tab = $derived(getActiveTab())
  const path = $derived(notePathOfTab(tab))
  const panel = $derived(getRightPanel())

  const PANELS: { id: RightPanel; labelKey: string; icon: typeof LinkIcon }[] =
    [
      { id: 'outline', labelKey: 'outline.title', icon: ListTreeIcon },
      { id: 'backlinks', labelKey: 'backlinks.title', icon: LinkIcon },
    ]
</script>

<div class="flex h-full min-h-0 flex-col">
  <div
    role="tablist"
    aria-label={t('sidebar.panels')}
    class="flex shrink-0 items-center gap-0.5 px-2 pt-2 pb-1"
  >
    {#each PANELS as item (item.id)}
      <Button
        role="tab"
        variant="ghost"
        size="sm"
        aria-selected={panel === item.id}
        class={cn(
          'h-7 gap-1.5 px-2 text-xs',
          panel === item.id && 'bg-accent text-accent-foreground',
        )}
        onclick={() => setRightPanel(item.id)}
      >
        <item.icon class="size-3.5" />
        {t(item.labelKey)}
      </Button>
    {/each}
  </div>
  <div class="min-h-0 flex-1 overflow-auto">
    {#if panel === 'outline'}
      <OutlinePanel {path} tabId={path ? (tab?.id ?? null) : null} />
    {:else}
      <BacklinksPanel {path} />
    {/if}
  </div>
</div>
