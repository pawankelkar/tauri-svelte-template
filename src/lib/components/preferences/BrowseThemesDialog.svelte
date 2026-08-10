<script lang="ts">
  import SearchIcon from '@lucide/svelte/icons/search'
  import * as Dialog from '$lib/components/ui/dialog'
  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import {
    listCatalogThemes,
    loadCatalogTheme,
  } from '$lib/theme/vscode-catalog'
  import { registerUserPreset } from '$lib/stores/theme.svelte'
  import { BUILTIN_PRESETS } from '$lib/theme/presets'
  import { toast } from '$lib/stores/toast'
  import { t } from '$lib/i18n/t.svelte'

  let {
    open = false,
    onOpenChange,
  }: { open?: boolean; onOpenChange?: (open: boolean) => void } = $props()

  let query = $state('')
  let modeFilter = $state<'all' | 'light' | 'dark'>('all')
  let installing = $state('')

  $effect(() => {
    if (open) {
      query = ''
      modeFilter = 'all'
      installing = ''
    }
  })

  const FILTERS = [
    { value: 'all', labelKey: 'preferences.appearance.browseFilterAll' },
    { value: 'light', labelKey: 'preferences.appearance.themeLight' },
    { value: 'dark', labelKey: 'preferences.appearance.themeDark' },
  ] as const

  /** Catalog entries that now ship as built-in presets need no install. */
  const builtinCatalogIds = new Set(BUILTIN_PRESETS.map((p) => p.id))

  let visible = $derived.by(() => {
    const q = query.trim().toLowerCase()
    return listCatalogThemes().filter(
      (e) =>
        (modeFilter === 'all' || e.type === modeFilter) &&
        (!q || e.displayName.toLowerCase().includes(q) || e.id.includes(q)),
    )
  })

  async function install(id: string): Promise<void> {
    installing = id
    try {
      const result = await loadCatalogTheme(id)
      if (result.error !== undefined) {
        toast.error(result.error)
        return
      }
      const { preset: registered, already } = registerUserPreset(result.preset)
      if (result.warnings.length) toast.warning(result.warnings.join(' '))
      toast.success(
        already
          ? t('preferences.appearance.installAlready', {
              name: registered.name,
            })
          : t('preferences.appearance.installSuccess', {
              name: registered.name,
              mode:
                registered.mode === 'light'
                  ? t('preferences.appearance.themeLight')
                  : t('preferences.appearance.themeDark'),
            }),
      )
    } finally {
      installing = ''
    }
  }
</script>

<Dialog.Root {open} {onOpenChange}>
  <Dialog.Content class="flex max-h-[80vh] flex-col md:max-w-[640px]">
    <Dialog.Header>
      <Dialog.Title>{t('preferences.appearance.browseTitle')}</Dialog.Title>
      <Dialog.Description>
        {t('preferences.appearance.browseDescription', {
          count: listCatalogThemes().length,
        })}
      </Dialog.Description>
    </Dialog.Header>

    <div class="flex items-center gap-3">
      <div class="relative flex-1">
        <SearchIcon
          class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
        />
        <Input
          class="pl-8"
          placeholder={t('preferences.appearance.browseSearchPlaceholder')}
          bind:value={query}
        />
      </div>
      <div
        class="bg-muted inline-flex shrink-0 rounded-md p-0.5"
        role="radiogroup"
      >
        {#each FILTERS as f (f.value)}
          <button
            type="button"
            role="radio"
            aria-checked={modeFilter === f.value}
            class="rounded-sm px-2.5 py-1 text-xs font-medium transition-colors {modeFilter ===
            f.value
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground'}"
            onclick={() => (modeFilter = f.value)}
          >
            {t(f.labelKey)}
          </button>
        {/each}
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto rounded-md border">
      {#each visible as entry (entry.id)}
        <div
          class="hover:bg-accent flex items-center gap-3 border-b px-3 py-2 last:border-b-0"
        >
          <span
            class="relative inline-flex h-8 w-11 shrink-0 items-center justify-center rounded-sm border border-white/30"
            style="background: {entry.swatch.bg}"
          >
            <span
              class="text-xs font-semibold"
              style="color: {entry.swatch.fg}"
            >
              Aa
            </span>
            <span
              class="absolute right-0.5 bottom-0.5 size-2.5 rounded-full border border-white/30"
              style="background: {entry.swatch.accent}"
            ></span>
          </span>
          <span class="flex-1 truncate text-sm">{entry.displayName}</span>
          <span
            class="text-muted-foreground shrink-0 rounded-full border px-2 py-px text-[10px]"
          >
            {entry.type === 'light'
              ? t('preferences.appearance.themeLight')
              : t('preferences.appearance.themeDark')}
          </span>
          {#if builtinCatalogIds.has(entry.id)}
            <span class="text-muted-foreground shrink-0 text-[10px]">
              {t('preferences.appearance.installAlready', {
                name: entry.displayName,
              })}
            </span>
          {:else}
            <Button
              variant="outline"
              size="sm"
              disabled={installing === entry.id}
              onclick={() => install(entry.id)}
            >
              {t('preferences.appearance.installButton')}
            </Button>
          {/if}
        </div>
      {:else}
        <p class="text-muted-foreground p-4 text-sm">
          {t('preferences.appearance.browseNoMatches', { query })}
        </p>
      {/each}
    </div>

    <Dialog.Footer>
      <Button variant="ghost" onclick={() => onOpenChange?.(false)}>
        {t('preferences.appearance.browseClose')}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
