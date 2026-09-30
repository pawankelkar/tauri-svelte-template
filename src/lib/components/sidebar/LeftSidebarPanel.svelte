<script lang="ts">
  import FilesIcon from '@lucide/svelte/icons/files'
  import SearchIcon from '@lucide/svelte/icons/search'
  import FilePlusIcon from '@lucide/svelte/icons/file-plus'
  import FolderPlusIcon from '@lucide/svelte/icons/folder-plus'
  import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down'
  import LibraryIcon from '@lucide/svelte/icons/library'
  import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle'
  import { Button } from '$lib/components/ui/button'
  import FileTree from './FileTree.svelte'
  import SearchView from './SearchView.svelte'
  import {
    findTreeNode,
    getCurrentVault,
    getIndexStatus,
  } from '$lib/stores/vault.svelte'
  import {
    getLeftActivity,
    setLeftActivity,
    type LeftActivity,
  } from '$lib/stores/sidebar.svelte'
  import {
    setCreateVaultOpen,
    setVaultSwitcherOpen,
  } from '$lib/stores/overlays.svelte'
  import { getTreeSelection } from '$lib/stores/tree-state.svelte'
  import { newFolderIn, newNoteIn, targetFolder } from './file-tree-actions'
  import { pickAndOpenVault } from '$lib/vault/vault-actions'
  import { t } from '$lib/i18n/t.svelte'
  import { cn } from '$lib/utils'

  const vault = $derived(getCurrentVault())
  const status = $derived(getIndexStatus())
  const activity = $derived(getLeftActivity())

  const ACTIVITIES: {
    id: LeftActivity
    labelKey: string
    icon: typeof FilesIcon
  }[] = [
    { id: 'files', labelKey: 'sidebar.files', icon: FilesIcon },
    { id: 'search', labelKey: 'sidebar.search', icon: SearchIcon },
  ]

  // New entries go next to the selected row, like a file manager.
  function selectedFolder(): string {
    const path = getTreeSelection()
    return targetFolder(path ? (findTreeNode(path) ?? null) : null)
  }
</script>

<div class="flex h-full min-h-0 flex-col">
  {#if vault}
    <div class="flex shrink-0 items-center gap-1 px-2 pt-2 pb-1">
      <button
        type="button"
        class="hover:bg-accent/60 flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm font-semibold"
        title={vault.path}
        aria-label={t('vault.switcher.open', { name: vault.name })}
        onclick={() => setVaultSwitcherOpen(true)}
      >
        <LibraryIcon
          class="text-muted-foreground size-4 shrink-0"
          aria-hidden="true"
        />
        <span class="truncate">{vault.name}</span>
        <ChevronsUpDownIcon
          class="text-muted-foreground ml-auto size-3.5 shrink-0"
          aria-hidden="true"
        />
      </button>
    </div>

    <div class="flex shrink-0 items-center gap-0.5 px-2 pb-1">
      <div
        role="tablist"
        aria-label={t('sidebar.activities')}
        class="flex gap-0.5"
      >
        {#each ACTIVITIES as item (item.id)}
          <Button
            role="tab"
            variant="ghost"
            size="icon-sm"
            aria-selected={activity === item.id}
            aria-label={t(item.labelKey)}
            title={t(item.labelKey)}
            class={cn(
              activity === item.id && 'bg-accent text-accent-foreground',
            )}
            onclick={() => setLeftActivity(item.id)}
          >
            <item.icon />
          </Button>
        {/each}
      </div>
      {#if activity === 'files'}
        <div class="ml-auto flex gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('fileTree.menu.newNote')}
            title={t('fileTree.menu.newNote')}
            onclick={() => void newNoteIn(selectedFolder())}
          >
            <FilePlusIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('fileTree.menu.newFolder')}
            title={t('fileTree.menu.newFolder')}
            onclick={() => void newFolderIn(selectedFolder())}
          >
            <FolderPlusIcon />
          </Button>
        </div>
      {/if}
    </div>

    <div class="min-h-0 flex-1 overflow-auto">
      {#if activity === 'files'}
        <FileTree />
      {:else}
        <SearchView />
      {/if}
    </div>

    <div
      class="text-muted-foreground border-border/60 flex h-7 shrink-0 items-center gap-1.5 border-t px-3 text-xs"
      aria-live="polite"
      data-testid="index-status"
    >
      {#if status?.indexing}
        <LoaderCircleIcon class="size-3 animate-spin" aria-hidden="true" />
        <span class="truncate">
          {t('vault.status.indexing', {
            done: status.done,
            total: status.total,
          })}
        </span>
      {:else if status}
        <span class="truncate"
          >{t('vault.status.notes', { count: status.noteCount })}</span
        >
      {/if}
    </div>
  {:else}
    <div class="flex flex-col gap-2 p-4">
      <p class="text-muted-foreground text-xs">{t('sidebar.noVault')}</p>
      <div class="flex flex-wrap gap-1.5">
        <Button
          size="xs"
          variant="outline"
          onclick={() => void pickAndOpenVault()}
        >
          {t('vault.open.action')}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          onclick={() => setCreateVaultOpen(true)}
        >
          {t('vault.create.action')}
        </Button>
      </div>
    </div>
  {/if}
</div>
