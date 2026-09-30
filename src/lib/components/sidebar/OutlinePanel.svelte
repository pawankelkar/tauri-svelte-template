<script lang="ts">
  import type { Heading } from '$lib/tauri-bindings'
  import * as api from '$lib/vault/api'
  import { getDoc } from '$lib/stores/notes.svelte'
  import {
    getCursorLine,
    revealInTab,
  } from '$lib/editor/editor-registry.svelte'
  import { createLatestRequest } from '$lib/utils/latest-request.svelte'
  import { t } from '$lib/i18n/t.svelte'
  import { cn } from '$lib/utils'

  let { path, tabId }: { path: string | null; tabId: string | null } = $props()

  const OUTLINE_DEBOUNCE_MS = 250

  // Rust parses the headings; the panel only lays them out.
  const outline = createLatestRequest<string, Heading[]>(
    (content) => api.getOutline(content),
    [],
    OUTLINE_DEBOUNCE_MS,
  )

  const doc = $derived(getDoc(path))
  const content = $derived(doc?.loaded ? doc.content : null)
  let shownFor: string | null = null

  $effect(() => {
    if (content === null) {
      shownFor = null
      outline.reset()
      return
    }
    const immediate = path !== shownFor
    shownFor = path
    outline.run(content, { immediate })
  })

  $effect(() => () => outline.cancel())

  const minLevel = $derived(
    outline.value.reduce((m, h) => Math.min(m, h.level), 6),
  )

  // The heading the caret is under: the last one at or above its line.
  const currentLine = $derived.by(() => {
    const cursor = getCursorLine(tabId ?? undefined)
    if (cursor === undefined) return undefined
    let line: number | undefined
    for (const h of outline.value) {
      if (h.line > cursor) break
      line = h.line
    }
    return line
  })

  function jump(heading: Heading): void {
    if (tabId) revealInTab(tabId, { line: heading.line })
  }
</script>

<nav class="flex flex-col" aria-label={t('outline.title')}>
  {#if !path}
    <p class="text-muted-foreground px-4 py-3 text-xs">{t('outline.noNote')}</p>
  {:else if outline.error}
    <p class="text-destructive px-4 py-3 text-xs" role="alert">
      {outline.error}
    </p>
  {:else if outline.value.length === 0}
    {#if !outline.loading}
      <p class="text-muted-foreground px-4 py-3 text-xs">
        {t('outline.empty')}
      </p>
    {/if}
  {:else}
    <ul class="flex flex-col px-1.5 py-2">
      {#each outline.value as heading (heading.line)}
        <li>
          <button
            type="button"
            class={cn(
              'hover:bg-accent/60 focus-visible:bg-accent w-full truncate rounded-md py-1 pr-2 text-left text-sm outline-none',
              currentLine === heading.line
                ? 'text-foreground font-medium'
                : 'text-muted-foreground',
            )}
            style:padding-left="{(heading.level - minLevel) * 12 + 10}px"
            aria-current={currentLine === heading.line ? 'location' : undefined}
            onclick={() => jump(heading)}
          >
            {heading.text}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</nav>
