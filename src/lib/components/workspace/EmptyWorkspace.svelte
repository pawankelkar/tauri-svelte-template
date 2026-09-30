<script lang="ts">
  import NotebookPenIcon from '@lucide/svelte/icons/notebook-pen'
  import FolderPlusIcon from '@lucide/svelte/icons/folder-plus'
  import FolderOpenIcon from '@lucide/svelte/icons/folder-open'
  import FilePlusIcon from '@lucide/svelte/icons/file-plus'
  import SearchIcon from '@lucide/svelte/icons/search'
  import LibraryIcon from '@lucide/svelte/icons/library'
  import { Button } from '$lib/components/ui/button'
  import { Kbd } from '$lib/components/ui/kbd'
  import { OPEN_COMMAND_PALETTE, formatCommandShortcut } from '$lib/commands'
  import { NOTE_NEW, NOTE_QUICK_OPEN } from '$lib/commands/note-commands'
  import { getCurrentVault, getRecentVaults } from '$lib/stores/vault.svelte'
  import { createAndOpenNote } from '$lib/stores/notes.svelte'
  import {
    setCreateVaultOpen,
    setQuickOpenOpen,
  } from '$lib/stores/overlays.svelte'
  import { pickAndOpenVault, switchToVault } from '$lib/vault/vault-actions'
  import { t } from '$lib/i18n/t.svelte'

  const MAX_RECENT = 5

  const vault = $derived(getCurrentVault())
  const recent = $derived(getRecentVaults().slice(0, MAX_RECENT))

  // Follow the user's bindings; a cleared binding hides its chip rather than
  // advertising a chord that does nothing.
  const paletteShortcut = $derived(formatCommandShortcut(OPEN_COMMAND_PALETTE))
  const newNoteShortcut = $derived(formatCommandShortcut(NOTE_NEW))
  const quickOpenShortcut = $derived(formatCommandShortcut(NOTE_QUICK_OPEN))

  // The translation places the chip, so word order stays right in every
  // language: split the sentence around a sentinel standing in for it.
  const SLOT = '\u0000'
  const hintParts = $derived(
    t('workspace.empty.paletteHint', { shortcut: SLOT }).split(SLOT),
  )
</script>

<div class="flex h-full items-center justify-center overflow-auto p-8">
  <div class="flex w-full max-w-sm flex-col items-center text-center">
    <div
      class="bg-primary/10 text-primary mb-5 flex size-14 items-center justify-center rounded-2xl"
      aria-hidden="true"
    >
      <NotebookPenIcon class="size-7" />
    </div>

    {#if vault}
      <h2 class="text-xl font-semibold tracking-tight">
        {t('workspace.noNote.title')}
      </h2>
      <p class="text-muted-foreground mt-2 text-sm text-balance">
        {t('workspace.noNote.description', { name: vault.name })}
      </p>
      <div class="mt-6 flex w-full flex-col gap-1.5">
        <Button
          variant="outline"
          class="justify-start"
          onclick={() => void createAndOpenNote()}
        >
          <FilePlusIcon />
          {t('workspace.noNote.newNote')}
          {#if newNoteShortcut}
            <Kbd class="ml-auto">{newNoteShortcut}</Kbd>
          {/if}
        </Button>
        <Button
          variant="outline"
          class="justify-start"
          onclick={() => setQuickOpenOpen(true)}
        >
          <SearchIcon />
          {t('workspace.noNote.quickOpen')}
          {#if quickOpenShortcut}
            <Kbd class="ml-auto">{quickOpenShortcut}</Kbd>
          {/if}
        </Button>
      </div>
    {:else}
      <h2 class="text-xl font-semibold tracking-tight">
        {t('workspace.empty.title')}
      </h2>
      <p class="text-muted-foreground mt-2 text-sm text-balance">
        {t('workspace.empty.description')}
      </p>
      <div class="mt-6 flex flex-wrap justify-center gap-2">
        <Button onclick={() => setCreateVaultOpen(true)}>
          <FolderPlusIcon />
          {t('workspace.empty.createVault')}
        </Button>
        <Button variant="outline" onclick={() => void pickAndOpenVault()}>
          <FolderOpenIcon />
          {t('workspace.empty.openVault')}
        </Button>
      </div>
      {#if recent.length}
        <section
          class="mt-8 w-full text-left"
          aria-labelledby="empty-recent-heading"
        >
          <h3
            id="empty-recent-heading"
            class="text-muted-foreground mb-1.5 px-2 text-xs font-medium"
          >
            {t('workspace.empty.recent')}
          </h3>
          <ul class="flex flex-col gap-px">
            {#each recent as item (item.id)}
              <li>
                <button
                  type="button"
                  class="hover:bg-accent focus-visible:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none"
                  onclick={() => void switchToVault(item.id)}
                >
                  <LibraryIcon
                    class="text-muted-foreground size-4 shrink-0"
                    aria-hidden="true"
                  />
                  <span class="flex min-w-0 flex-col">
                    <span class="truncate text-sm">{item.name}</span>
                    <span class="text-muted-foreground truncate text-xs"
                      >{item.path}</span
                    >
                  </span>
                </button>
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    {/if}

    {#if paletteShortcut}
      <p class="text-muted-foreground mt-10 text-xs">
        {hintParts[0]}<Kbd class="mx-1">{paletteShortcut}</Kbd>{hintParts[1]}
      </p>
    {/if}
  </div>
</div>
