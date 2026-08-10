<script lang="ts">
  import { Input } from '$lib/components/ui/input'
  import { Label } from '$lib/components/ui/label'
  import { setAnchors } from '$lib/stores/theme.svelte'
  import {
    validateAnchorEdit,
    type AnchorEditResult,
  } from '$lib/theme/anchor-validation'
  import { isHexColor, type ThemeProfile } from '$lib/theme/schema'
  import { contrastRatio } from '$lib/utils/color'
  import type { ThemeVariantMode } from '$lib/theme/engine'
  import { t } from '$lib/i18n/t.svelte'

  // "slot" is a reserved attribute name in Svelte, hence profileSlot.
  let {
    profileSlot,
    profile,
  }: { profileSlot: ThemeVariantMode; profile: ThemeProfile } = $props()

  const FIELDS = [
    { key: 'accent', labelKey: 'preferences.appearance.anchorAccent' },
    { key: 'background', labelKey: 'preferences.appearance.anchorBackground' },
    { key: 'foreground', labelKey: 'preferences.appearance.anchorForeground' },
  ] as const

  type AnchorField = (typeof FIELDS)[number]['key']

  // Drafts keep transiently-invalid text visible while typing; the store
  // only ever receives values that pass validateAnchorEdit, so the live
  // theme (and the colour swatches, which mirror the store) never go
  // invalid. The $effect below re-seeds drafts on any external profile
  // change: preset switch, slot switch, reset, or our own successful commit.
  // svelte-ignore state_referenced_locally
  let drafts = $state({
    accent: profile.accent,
    background: profile.background,
    foreground: profile.foreground,
  })
  let error = $state<AnchorEditResult | null>(null)

  $effect(() => {
    drafts.accent = profile.accent
    drafts.background = profile.background
    drafts.foreground = profile.foreground
    error = null
  })

  function commit(field: AnchorField, value: string): void {
    drafts[field] = value
    const candidate = {
      accent: drafts.accent,
      background: drafts.background,
      foreground: drafts.foreground,
    }
    const result = validateAnchorEdit(candidate)
    if (!result.valid) {
      error = result
      return
    }
    error = null
    setAnchors(profileSlot, candidate)
  }

  // <input type="color"> only accepts 6-digit hex.
  function toColorInput(hex: string): string {
    if (!isHexColor(hex)) return '#000000'
    return hex.length === 4
      ? '#' + [...hex.slice(1)].map((c) => c + c).join('')
      : hex
  }

  const ratio = (a: string, b: string): number | null =>
    isHexColor(a) && isHexColor(b) ? contrastRatio(a, b) : null

  let fgBg = $derived(ratio(drafts.foreground, drafts.background))
  let accentBg = $derived(ratio(drafts.accent, drafts.background))

  function textRating(r: number | null): { label: string; ok: boolean } | null {
    if (r == null) return null
    if (r >= 7) return { label: 'AAA', ok: true }
    if (r >= 4.5) return { label: 'AA', ok: true }
    return { label: t('preferences.appearance.ratingLow'), ok: false }
  }

  function accentRating(
    r: number | null,
  ): { label: string; ok: boolean } | null {
    if (r == null) return null
    return r >= 3
      ? { label: t('preferences.appearance.ratingOk'), ok: true }
      : { label: t('preferences.appearance.ratingLow'), ok: false }
  }

  const readouts = $derived([
    {
      label: t('preferences.appearance.foregroundOnBackground'),
      value: fgBg,
      rating: textRating(fgBg),
    },
    {
      label: t('preferences.appearance.accentOnBackground'),
      value: accentBg,
      rating: accentRating(accentBg),
    },
  ])
</script>

<div class="grid max-w-2xl grid-cols-3 gap-3">
  {#each FIELDS as f (f.key)}
    <div class="space-y-1.5">
      <Label for="anchor-{profileSlot}-{f.key}">{t(f.labelKey)}</Label>
      <div class="flex items-center gap-1.5">
        <input
          type="color"
          class="border-input size-8 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5"
          value={toColorInput(profile[f.key])}
          aria-label={t('preferences.appearance.colorPicker', {
            field: t(f.labelKey),
          })}
          oninput={(e) => commit(f.key, e.currentTarget.value)}
        />
        <Input
          id="anchor-{profileSlot}-{f.key}"
          class="font-mono {error?.valid === false && error.field === f.key
            ? 'border-destructive'
            : ''}"
          value={drafts[f.key]}
          spellcheck={false}
          oninput={(e) => (drafts[f.key] = e.currentTarget.value)}
          onchange={(e) => commit(f.key, e.currentTarget.value)}
        />
      </div>
    </div>
  {/each}
</div>

{#if error && !error.valid}
  <p class="text-destructive text-sm">{error.message}</p>
{/if}

<div class="text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-xs">
  {#each readouts as row (row.label)}
    <span>
      {row.label}:
      {#if row.value != null && row.rating}
        <strong class="text-foreground font-semibold"
          >{row.value.toFixed(1)}:1</strong
        >
        <span
          class="ml-1 inline-block rounded-full px-1.5 py-px text-[10px] font-semibold {row
            .rating.ok
            ? 'bg-primary/10 text-foreground'
            : 'bg-destructive/10 text-destructive'}"
        >
          {row.rating.label}
        </span>
      {:else}
        <strong>—</strong>
      {/if}
    </span>
  {/each}
</div>

<div class="max-w-2xl space-y-1.5">
  <div class="flex items-center justify-between">
    <Label for="anchor-{profileSlot}-contrast">
      {t('preferences.appearance.contrastLabel')}
    </Label>
    <span class="text-muted-foreground text-xs tabular-nums">
      {profile.contrast}
    </span>
  </div>
  <input
    id="anchor-{profileSlot}-contrast"
    type="range"
    min="0"
    max="100"
    step="1"
    class="accent-primary w-full"
    value={profile.contrast}
    oninput={(e) =>
      setAnchors(profileSlot, { contrast: Number(e.currentTarget.value) })}
  />
  <p class="text-muted-foreground text-xs">
    {t('preferences.appearance.contrastHint')}
  </p>
</div>
