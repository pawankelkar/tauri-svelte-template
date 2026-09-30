<script lang="ts">
  import { tick } from 'svelte'
  import SearchIcon from '@lucide/svelte/icons/search'
  import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle'
  import type { SearchHit } from '$lib/tauri-bindings'
  import { Input } from '$lib/components/ui/input'
  import HighlightedText from '$lib/components/vault/HighlightedText.svelte'
  import { searchFulltext } from '$lib/vault/api'
  import { parentOf } from '$lib/vault/paths'
  import {
    getSearchFocusRequest,
    getSearchQuery,
    setSearchQuery,
  } from '$lib/stores/sidebar.svelte'
  import { openNote } from '$lib/workspace/open-note'
  import { createLatestRequest } from '$lib/utils/latest-request.svelte'
  import { t } from '$lib/i18n/t.svelte'

  const SEARCH_DEBOUNCE_MS = 200
  const LIMIT = 50

  const search = createLatestRequest<string, SearchHit[]>(
    (q) => searchFulltext(q, LIMIT),
    [],
    SEARCH_DEBOUNCE_MS,
  )

  let input = $state<HTMLInputElement | null>(null)
  let list = $state<HTMLUListElement | null>(null)

  const query = $derived(getSearchQuery())
  const trimmed = $derived(query.trim())

  $effect(() => {
    if (trimmed) search.run(trimmed)
    else search.reset()
  })

  $effect(() => {
    if (getSearchFocusRequest() === 0) return
    void tick().then(() => {
      input?.focus()
      input?.select()
    })
  })

  $effect(() => () => search.cancel())

  function open(event: MouseEvent | KeyboardEvent, hit: SearchHit): void {
    const keep = event.metaKey || event.ctrlKey
    openNote(hit.path, { preview: !keep })
  }

  function focusResult(index: number): void {
    const items = list?.querySelectorAll<HTMLElement>('[data-hit]')
    if (!items?.length) return
    items[Math.max(0, Math.min(index, items.length - 1))]?.focus()
  }

  function onInputKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusResult(0)
    } else if (event.key === 'Enter' && search.value[0]) {
      event.preventDefault()
      open(event, search.value[0])
    } else if (event.key === 'Escape' && query) {
      event.preventDefault()
      setSearchQuery('')
    }
  }

  function onResultKeydown(event: KeyboardEvent, index: number): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusResult(index + 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (index === 0) input?.focus()
      else focusResult(index - 1)
    }
  }
</script>

<div class="flex h-full min-h-0 flex-col">
  <div class="relative shrink-0 px-2 pt-2 pb-1.5">
    <SearchIcon
      class="text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2"
      aria-hidden="true"
    />
    <Input
      bind:ref={input}
      value={query}
      oninput={(e) => setSearchQuery(e.currentTarget.value)}
      onkeydown={onInputKeydown}
      type="search"
      class="h-7 pl-7 text-sm"
      placeholder={t('search.placeholder')}
      aria-label={t('search.label')}
    />
  </div>

  <div class="min-h-0 flex-1 overflow-auto">
    {#if !trimmed}
      <p class="text-muted-foreground px-4 py-3 text-xs">{t('search.hint')}</p>
    {:else if search.error}
      <p class="text-destructive px-4 py-3 text-xs" role="alert">
        {search.error}
      </p>
    {:else if search.value.length === 0}
      <p
        class="text-muted-foreground flex items-center gap-2 px-4 py-3 text-xs"
      >
        {#if search.loading}
          <LoaderCircleIcon class="size-3.5 animate-spin" aria-hidden="true" />
          {t('search.searching')}
        {:else}
          {t('search.noResults', { query: trimmed })}
        {/if}
      </p>
    {:else}
      <p
        class="text-muted-foreground px-4 pt-1 pb-1.5 text-xs"
        aria-live="polite"
      >
        {t('search.resultCount', { count: search.value.length })}
      </p>
      <ul
        bind:this={list}
        class="flex flex-col gap-px px-1.5 pb-4"
        aria-label={t('search.results')}
      >
        {#each search.value as hit, i (hit.path)}
          <li>
            <button
              type="button"
              data-hit
              class="hover:bg-accent/60 focus-visible:bg-accent flex w-full flex-col gap-0.5 rounded-md px-2.5 py-1.5 text-left outline-none"
              onclick={(e) => open(e, hit)}
              onkeydown={(e) => onResultKeydown(e, i)}
            >
              <span class="flex min-w-0 items-baseline gap-2">
                <span class="truncate text-sm font-medium">{hit.title}</span>
                {#if parentOf(hit.path)}
                  <span class="text-muted-foreground truncate text-xs">
                    {parentOf(hit.path)}
                  </span>
                {/if}
              </span>
              {#if hit.snippet.length}
                <HighlightedText
                  parts={hit.snippet}
                  class="text-muted-foreground line-clamp-2 text-xs"
                />
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>
