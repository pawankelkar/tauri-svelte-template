<script lang="ts">
  import { open as openFileDialog } from '@tauri-apps/plugin-dialog'
  import Trash2Icon from '@lucide/svelte/icons/trash-2'
  import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw'
  import DownloadIcon from '@lucide/svelte/icons/download'
  import PaletteIcon from '@lucide/svelte/icons/palette'
  import { Button } from '$lib/components/ui/button'
  import ModePreviewCards from './ModePreviewCards.svelte'
  import ThemeAnchorFields from './ThemeAnchorFields.svelte'
  import BrowseThemesDialog from './BrowseThemesDialog.svelte'
  import {
    getResolvedMode,
    getProfile,
    getUserPresets,
    setPreset,
    registerUserPreset,
    deleteUserPreset,
    canResetProfile,
    resetProfileToPreset,
  } from '$lib/stores/theme.svelte'
  import { BUILTIN_PRESETS } from '$lib/theme/presets'
  import { parseJsonc } from '$lib/theme/jsonc'
  import { convertVsCodeTheme } from '$lib/theme/vscode-import'
  import { commands, unwrapResult } from '$lib/tauri-bindings'
  import { confirm } from '$lib/stores/confirm.svelte'
  import { toast } from '$lib/stores/toast'
  import { logger } from '$lib/logger'
  import type { ThemePreset } from '$lib/theme/schema'
  import type { ThemeVariantMode } from '$lib/theme/engine'
  import { t } from '$lib/i18n/t.svelte'

  // Which profile the Theme section edits — independent of the live mode so
  // a Light-mode user can still tune their Dark profile.
  let editingSlot = $state<ThemeVariantMode>(getResolvedMode())
  let browseOpen = $state(false)

  const profile = $derived(getProfile(editingSlot))
  const slotPresets = $derived(
    [...BUILTIN_PRESETS, ...getUserPresets()].filter(
      (p) => p.mode === editingSlot,
    ),
  )

  const SLOTS = [
    { value: 'light', labelKey: 'preferences.appearance.themeLight' },
    { value: 'dark', labelKey: 'preferences.appearance.themeDark' },
  ] as const

  function isUserPreset(p: ThemePreset): boolean {
    return !BUILTIN_PRESETS.some((b) => b.id === p.id)
  }

  async function handleDeletePreset(
    event: MouseEvent,
    preset: ThemePreset,
  ): Promise<void> {
    event.stopPropagation()
    const inUse =
      getProfile('light').presetId === preset.id ||
      getProfile('dark').presetId === preset.id
    const confirmed = await confirm({
      titleKey: 'preferences.appearance.deletePresetTitle',
      descriptionKey: inUse
        ? 'preferences.appearance.deletePresetInUse'
        : 'preferences.appearance.deletePresetConfirm',
      descriptionOptions: { name: preset.name },
      confirmKey: 'preferences.appearance.deletePresetAction',
      destructive: true,
    })
    if (confirmed) deleteUserPreset(preset.id)
  }

  /**
   * File picker → Rust read (size/extension gated) → JSONC parse → engine
   * conversion → registry, then activate in the slot matching the theme's
   * own mode. Every failure lands in a toast with the converter's actionable
   * message; a cancelled picker is not a failure.
   */
  async function importTheme(): Promise<void> {
    try {
      const path = await openFileDialog({
        multiple: false,
        directory: false,
        filters: [{ name: 'VS Code Theme', extensions: ['json', 'jsonc'] }],
      })
      if (path === null) return

      const text = unwrapResult(await commands.readThemeFile(String(path)))
      let parsed: unknown
      try {
        parsed = parseJsonc(text)
      } catch {
        toast.error(t('preferences.appearance.importFailed'), {
          description: t('preferences.appearance.importInvalidJson'),
        })
        return
      }

      const fileName = String(path).replace(/^.*[\\/]/, '')
      const result = convertVsCodeTheme(parsed, { fileName })
      if (result.error !== undefined) {
        toast.error(t('preferences.appearance.importFailed'), {
          description: result.error,
        })
        return
      }

      const { preset: registered } = registerUserPreset(result.preset)
      setPreset(registered.mode, registered.id)
      editingSlot = registered.mode
      toast.success(
        t('preferences.appearance.importSuccess', { name: registered.name }),
        result.warnings.length
          ? { description: result.warnings.join(' ') }
          : undefined,
      )
    } catch (e) {
      logger.error('Theme import failed', e)
      toast.error(t('preferences.appearance.importFailed'), {
        description: e instanceof Error ? e.message : String(e),
      })
    }
  }
</script>

<section class="space-y-2">
  <h3 class="text-sm font-semibold">
    {t('preferences.appearance.sectionMode')}
  </h3>
  <ModePreviewCards />
</section>

<section class="space-y-3">
  <div class="flex items-center justify-between">
    <h3 class="text-sm font-semibold">
      {t('preferences.appearance.customizeProfile')}
    </h3>
    <div class="bg-muted inline-flex rounded-md p-0.5" role="radiogroup">
      {#each SLOTS as s (s.value)}
        <button
          type="button"
          role="radio"
          aria-checked={editingSlot === s.value}
          class="rounded-sm px-2.5 py-1 text-xs font-medium transition-colors {editingSlot ===
          s.value
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground'}"
          onclick={() => (editingSlot = s.value)}
        >
          {t(s.labelKey)}
        </button>
      {/each}
    </div>
  </div>

  <div
    class="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2"
    role="radiogroup"
  >
    {#each slotPresets as p (p.id)}
      <div class="group relative">
        <button
          type="button"
          role="radio"
          aria-checked={profile.presetId === p.id}
          class="flex w-full flex-col items-center gap-1.5 rounded-lg border p-2 transition-colors {profile.presetId ===
          p.id
            ? 'border-ring ring-ring/50 ring-[2px]'
            : 'hover:bg-accent'}"
          onclick={() => setPreset(editingSlot, p.id)}
        >
          <span
            class="relative flex h-11 w-full items-center justify-center rounded-md border"
            style="background: {p.background}"
          >
            <span class="font-semibold" style="color: {p.foreground}">Aa</span>
            <span
              class="absolute right-1 bottom-1 size-3 rounded-full border border-white/30"
              style="background: {p.accent}"
            ></span>
          </span>
          <span class="text-xs font-semibold">{p.name}</span>
          {#if profile.presetId === p.id && profile.customized}
            <span
              class="bg-primary/10 rounded-full px-1.5 py-px text-[10px] font-semibold"
            >
              {t('preferences.appearance.customizedPill')}
            </span>
          {/if}
        </button>
        {#if isUserPreset(p)}
          <button
            type="button"
            class="bg-popover text-muted-foreground hover:text-destructive absolute top-1 right-1 flex size-5 items-center justify-center rounded-md border opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
            aria-label={t('preferences.appearance.deletePresetLabel', {
              name: p.name,
            })}
            onclick={(e) => handleDeletePreset(e, p)}
          >
            <Trash2Icon class="size-3" />
          </button>
        {/if}
      </div>
    {/each}
  </div>

  <ThemeAnchorFields profileSlot={editingSlot} {profile} />
</section>

<div class="flex flex-wrap gap-2 border-t pt-4">
  <Button
    variant="ghost"
    size="sm"
    disabled={!canResetProfile(editingSlot)}
    onclick={() => resetProfileToPreset(editingSlot)}
  >
    <RotateCcwIcon />
    {t('preferences.appearance.resetToPreset')}
  </Button>
  <Button variant="ghost" size="sm" onclick={importTheme}>
    <DownloadIcon />
    {t('preferences.appearance.importThemeButton')}
  </Button>
  <Button variant="ghost" size="sm" onclick={() => (browseOpen = true)}>
    <PaletteIcon />
    {t('preferences.appearance.browseThemesButton')}
  </Button>
</div>

<BrowseThemesDialog
  open={browseOpen}
  onOpenChange={(v: boolean) => (browseOpen = v)}
/>
