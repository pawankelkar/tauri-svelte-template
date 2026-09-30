<script lang="ts">
  import FileTextIcon from '@lucide/svelte/icons/file-text'
  import FilePlusIcon from '@lucide/svelte/icons/file-plus'
  import * as Command from '$lib/components/ui/command'
  import HighlightedText from '$lib/components/vault/HighlightedText.svelte'
  import type { QuickOpenItem } from '$lib/tauri-bindings'
  import * as api from '$lib/vault/api'
  import { noteStem } from '$lib/vault/paths'
  import { createNoteFromName } from '$lib/stores/notes.svelte'
  import {
    isQuickOpenOpen,
    setQuickOpenOpen,
  } from '$lib/stores/overlays.svelte'
  import { keepTab } from '$lib/workspace/tabs.svelte'
  import { openNote } from '$lib/workspace/open-note'
  import { createLatestRequest } from '$lib/utils/latest-request.svelte'
  import { formatCombo } from '$lib/commands'
  import { t } from '$lib/i18n/t.svelte'

  const QUICK_OPEN_DEBOUNCE_MS = 80
  const LIMIT = 50
  const CREATE_VALUE = '\u0000create'

  // Rust ranks (and, for an empty query, lists recent notes); the list is
  // shown as returned, so cmdk's own filtering is off.
  const results = createLatestRequest<string, QuickOpenItem[]>(
    (q) => api.quickOpen(q, LIMIT),
    [],
    QUICK_OPEN_DEBOUNCE_MS,
  )

  const open = $derived(isQuickOpenOpen())
  let query = $state('')
  let selected = $state('')
  // Set on pointerdown so a mod+click can open a kept tab (onSelect gets no
  // event of its own).
  let pointerKeep = false

  const trimmed = $derived(query.trim())

  $effect(() => {
    if (!open) {
      results.cancel()
      return
    }
    results.run(trimmed, { immediate: trimmed === '' })
  })

  // Offer to create the note unless one already goes by that name.
  const showCreate = $derived.by(() => {
    if (!trimmed) return false
    const wanted = trimmed.replace(/\.md$/i, '').toLowerCase()
    return !results.value.some(
      (item) =>
        item.title.toLowerCase() === wanted ||
        noteStem(item.path).toLowerCase() === wanted ||
        item.path.toLowerCase() === `${wanted}.md`,
    )
  })

  function close(): void {
    setQuickOpenOpen(false)
    query = ''
    selected = ''
  }

  function onOpenChange(next: boolean): void {
    if (next) setQuickOpenOpen(true)
    else close()
  }

  function choose(value: string, keep: boolean): void {
    const name = trimmed
    close()
    if (value === CREATE_VALUE) {
      void createNoteFromName(name)
      return
    }
    const id = openNote(value, { preview: !keep })
    if (id && keep) keepTab(id)
  }

  function onSelect(value: string): void {
    const keep = pointerKeep
    pointerKeep = false
    choose(value, keep)
  }

  function onInputKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return
    if (!selected) return
    event.preventDefault()
    event.stopPropagation()
    choose(selected, true)
  }

  function onPointerDown(event: PointerEvent): void {
    pointerKeep = event.metaKey || event.ctrlKey
  }
</script>

<Command.Dialog
  {open}
  {onOpenChange}
  bind:value={selected}
  shouldFilter={false}
  title={t('quickOpen.title')}
  description={t('quickOpen.description')}
>
  <Command.Input
    bind:value={query}
    placeholder={t('quickOpen.placeholder')}
    onkeydown={onInputKeydown}
  />
  <Command.List class="max-h-96">
    {#if results.value.length === 0 && !showCreate}
      <div class="text-muted-foreground py-6 text-center text-sm">
        {trimmed ? t('quickOpen.empty') : t('quickOpen.noRecent')}
      </div>
    {/if}
    {#if results.value.length > 0}
      <Command.Group
        heading={trimmed ? t('quickOpen.matches') : t('quickOpen.recent')}
      >
        {#each results.value as item (item.path)}
          <Command.Item
            value={item.path}
            onSelect={() => onSelect(item.path)}
            onpointerdown={onPointerDown}
          >
            <FileTextIcon class="text-muted-foreground" />
            <span class="flex min-w-0 flex-1 items-baseline gap-2">
              <HighlightedText parts={item.titleParts} class="truncate" />
              <HighlightedText
                parts={item.pathParts}
                class="text-muted-foreground ml-auto max-w-[55%] truncate text-xs"
              />
            </span>
          </Command.Item>
        {/each}
      </Command.Group>
    {/if}
    {#if showCreate}
      <Command.Group>
        <Command.Item
          value={CREATE_VALUE}
          onSelect={() => onSelect(CREATE_VALUE)}
          onpointerdown={onPointerDown}
        >
          <FilePlusIcon class="text-muted-foreground" />
          <span class="truncate"
            >{t('quickOpen.create', { name: trimmed })}</span
          >
        </Command.Item>
      </Command.Group>
    {/if}
  </Command.List>
  <div
    class="text-muted-foreground border-border/60 flex items-center gap-3 border-t px-3 py-1.5 text-xs"
  >
    <span>{t('quickOpen.hintOpen', { key: formatCombo('enter') })}</span>
    <span>{t('quickOpen.hintNewTab', { key: formatCombo('mod+enter') })}</span>
  </div>
</Command.Dialog>
