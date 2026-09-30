<script lang="ts">
  import FileTextIcon from '@lucide/svelte/icons/file-text'
  import type { Backlink } from '$lib/tauri-bindings'
  import { getBacklinks } from '$lib/vault/api'
  import { getLinksVersion } from '$lib/stores/notes.svelte'
  import { getTreeVersion } from '$lib/stores/vault.svelte'
  import { openNote } from '$lib/workspace/open-note'
  import { createLatestRequest } from '$lib/utils/latest-request.svelte'
  import { t } from '$lib/i18n/t.svelte'

  let { path }: { path: string | null } = $props()

  // Saves bump the links version in bursts while typing; wait for a pause.
  const REFRESH_DEBOUNCE_MS = 300

  const backlinks = createLatestRequest<string, Backlink[]>(
    (p) => getBacklinks(p),
    [],
    REFRESH_DEBOUNCE_MS,
  )

  interface Group {
    sourcePath: string
    sourceTitle: string
    links: Backlink[]
  }

  const groups = $derived.by((): Group[] => {
    const out: Group[] = []
    for (const link of backlinks.value) {
      const last = out.at(-1)
      if (last?.sourcePath === link.sourcePath) last.links.push(link)
      else
        out.push({
          sourcePath: link.sourcePath,
          sourceTitle: link.sourceTitle,
          links: [link],
        })
    }
    return out
  })

  let shownFor: string | null = null

  $effect(() => {
    void getLinksVersion()
    void getTreeVersion()
    if (!path) {
      shownFor = null
      backlinks.reset()
      return
    }
    // A different note answers at once; a refresh of the same one waits.
    const immediate = path !== shownFor
    if (immediate) backlinks.reset()
    shownFor = path
    backlinks.run(path, { immediate })
  })

  $effect(() => () => backlinks.cancel())

  function jump(event: MouseEvent, link: Backlink): void {
    const keep = event.metaKey || event.ctrlKey
    openNote(link.sourcePath, { preview: !keep, reveal: { line: link.line } })
  }
</script>

<section class="flex flex-col" aria-label={t('backlinks.title')}>
  {#if !path}
    <p class="text-muted-foreground px-4 py-3 text-xs">
      {t('backlinks.noNote')}
    </p>
  {:else if backlinks.error}
    <p class="text-destructive px-4 py-3 text-xs" role="alert">
      {backlinks.error}
    </p>
  {:else if groups.length === 0}
    {#if !backlinks.loading}
      <p class="text-muted-foreground px-4 py-3 text-xs">
        {t('backlinks.empty')}
      </p>
    {/if}
  {:else}
    <p class="text-muted-foreground px-4 pt-2 pb-1 text-xs">
      {t('backlinks.count', { count: backlinks.value.length })}
    </p>
    <ul class="flex flex-col gap-1 px-1.5 pb-4">
      {#each groups as group (group.sourcePath)}
        <li class="flex flex-col">
          <div
            class="flex items-center gap-1.5 px-2.5 py-1 text-sm font-medium"
          >
            <FileTextIcon
              class="text-muted-foreground size-3.5 shrink-0"
              aria-hidden="true"
            />
            <span class="truncate" title={group.sourcePath}
              >{group.sourceTitle}</span
            >
          </div>
          <ul class="flex flex-col">
            {#each group.links as link (link.line)}
              <li>
                <button
                  type="button"
                  class="hover:bg-accent/60 focus-visible:bg-accent text-muted-foreground w-full rounded-md py-1 pr-2.5 pl-7 text-left text-xs outline-none"
                  onclick={(e) => jump(e, link)}
                >
                  <span class="line-clamp-3">{link.context}</span>
                </button>
              </li>
            {/each}
          </ul>
        </li>
      {/each}
    </ul>
  {/if}
</section>
