<script lang="ts">
  import { tick } from 'svelte'
  import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert'
  import FileXIcon from '@lucide/svelte/icons/file-x'
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right'
  import { Button } from '$lib/components/ui/button'
  import NoteEditor from './NoteEditor.svelte'
  import type { ViewProps } from '$lib/workspace/view-registry'
  import { notePathOfTab } from '$lib/workspace/open-note'
  import { getTitleRenameRequest } from '$lib/workspace/rename-requests.svelte'
  import { closeTab } from '$lib/workspace/tabs.svelte'
  import {
    ensureDoc,
    getDoc,
    keepMine,
    reloadFromDisk,
    renameEntry,
    retryLoad,
  } from '$lib/stores/notes.svelte'
  import { hasVault, isVaultReady } from '$lib/stores/vault.svelte'
  import {
    noteStem,
    parentOf,
    renameTarget,
    validateName,
  } from '$lib/vault/paths'
  import { t } from '$lib/i18n/t.svelte'

  let { tab }: ViewProps = $props()

  const path = $derived(notePathOfTab(tab))
  const doc = $derived(getDoc(path))
  const folders = $derived(
    path ? parentOf(path).split('/').filter(Boolean) : [],
  )
  const stem = $derived(path ? noteStem(path) : '')

  // Tabs are restored before the last vault reopens; reading a note before
  // then would only fail with `noVault`.
  $effect(() => {
    if (path && isVaultReady() && hasVault()) void ensureDoc(path)
  })

  // --- Inline title rename ---------------------------------------------------

  let editingTitle = $state(false)
  let titleDraft = $state('')
  let titleError = $state<string | null>(null)
  let titleInput = $state<HTMLInputElement | null>(null)
  let lastRequest = 0

  async function startTitleEdit(): Promise<void> {
    if (!path) return
    titleDraft = stem
    titleError = null
    editingTitle = true
    await tick()
    titleInput?.focus()
    titleInput?.select()
  }

  $effect(() => {
    const request = getTitleRenameRequest()
    if (!request || request.seq === lastRequest || request.target !== tab.id)
      return
    lastRequest = request.seq
    void startTitleEdit()
  })

  async function commitTitle(): Promise<void> {
    if (!editingTitle || !path) return
    const name = titleDraft.trim()
    if (name === stem) {
      editingTitle = false
      return
    }
    const problem = validateName(name)
    if (problem) {
      titleError = t(problem)
      return
    }
    editingTitle = false
    await renameEntry(path, renameTarget(path, name, 'note'))
  }

  function onTitleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault()
      void commitTitle()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      editingTitle = false
    }
  }

  // --- Status ---------------------------------------------------------------

  const status = $derived.by(() => {
    if (!doc?.loaded) return null
    if (doc.conflict) return t('editor.status.conflict')
    if (doc.saving) return t('editor.status.saving')
    if (doc.saveError) return t('editor.status.saveFailed')
    if (doc.dirty) return t('editor.status.unsaved')
    return t('editor.status.saved')
  })

  function closeThisTab(): void {
    void closeTab(tab.id, { force: true })
  }
</script>

<div class="flex h-full min-h-0 flex-col">
  <header
    class="border-border/60 flex h-9 shrink-0 items-center gap-2 border-b px-4 text-sm"
  >
    <nav
      aria-label={t('editor.breadcrumb')}
      class="text-muted-foreground flex min-w-0 flex-1 items-center gap-1"
    >
      {#each folders as folder, i (i)}
        <span class="max-w-40 truncate">{folder}</span>
        <ChevronRightIcon
          class="size-3.5 shrink-0 opacity-60"
          aria-hidden="true"
        />
      {/each}
      {#if editingTitle}
        <input
          bind:this={titleInput}
          bind:value={titleDraft}
          class="text-foreground border-ring bg-background min-w-0 flex-1 rounded border px-1.5 py-0.5 outline-none"
          aria-label={t('editor.renameTitle')}
          aria-invalid={titleError !== null}
          onkeydown={onTitleKeydown}
          onblur={() => void commitTitle()}
        />
      {:else}
        <button
          type="button"
          class="text-foreground hover:bg-accent min-w-0 truncate rounded px-1 py-0.5 text-left font-medium"
          title={t('editor.renameHint')}
          ondblclick={() => void startTitleEdit()}
        >
          {stem}
        </button>
      {/if}
    </nav>
    {#if titleError && editingTitle}
      <span class="text-destructive shrink-0 text-xs" role="alert"
        >{titleError}</span
      >
    {:else if status}
      <span
        class="text-muted-foreground shrink-0 text-xs"
        class:text-destructive={doc?.saveError || doc?.conflict}
        aria-live="polite"
        data-testid="note-status"
      >
        {status}
      </span>
    {/if}
  </header>

  {#if doc?.conflict === 'modified'}
    <div
      role="alert"
      class="bg-destructive/10 border-destructive/30 flex shrink-0 flex-wrap items-center gap-3 border-b px-4 py-2 text-sm"
    >
      <TriangleAlertIcon
        class="text-destructive size-4 shrink-0"
        aria-hidden="true"
      />
      <p class="min-w-0 flex-1">{t('editor.conflict.modified')}</p>
      <Button
        size="sm"
        variant="outline"
        onclick={() => path && void reloadFromDisk(path)}
      >
        {t('editor.conflict.reload')}
      </Button>
      <Button size="sm" onclick={() => path && void keepMine(path)}>
        {t('editor.conflict.keepMine')}
      </Button>
    </div>
  {:else if doc?.conflict === 'removed'}
    <div
      role="alert"
      class="bg-destructive/10 border-destructive/30 flex shrink-0 flex-wrap items-center gap-3 border-b px-4 py-2 text-sm"
    >
      <FileXIcon class="text-destructive size-4 shrink-0" aria-hidden="true" />
      <p class="min-w-0 flex-1">{t('editor.conflict.removed')}</p>
      <Button
        size="sm"
        variant="outline"
        onclick={() => path && void reloadFromDisk(path)}
      >
        {t('editor.conflict.close')}
      </Button>
      <Button size="sm" onclick={() => path && void keepMine(path)}>
        {t('editor.conflict.restore')}
      </Button>
    </div>
  {/if}

  <div class="min-h-0 flex-1">
    {#if !path}
      <p class="text-muted-foreground p-8 text-sm">{t('editor.invalidPath')}</p>
    {:else if doc?.loadError}
      <div
        class="flex h-full flex-col items-center justify-center gap-3 p-8 text-center"
      >
        <p class="text-sm font-medium">{t('editor.loadFailed')}</p>
        <p class="text-muted-foreground max-w-md text-xs">{doc.loadError}</p>
        <div class="flex gap-2">
          <Button size="sm" variant="outline" onclick={closeThisTab}>
            {t('editor.conflict.close')}
          </Button>
          <Button size="sm" onclick={() => void retryLoad(path)}>
            {t('editor.retry')}
          </Button>
        </div>
      </div>
    {:else if doc?.loaded}
      <NoteEditor {doc} tabId={tab.id} />
    {/if}
  </div>
</div>
