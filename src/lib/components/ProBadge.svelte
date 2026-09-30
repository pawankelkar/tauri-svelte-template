<script lang="ts">
  import LockIcon from '@lucide/svelte/icons/lock'
  import { cn } from '$lib/utils'
  import type { ProFeature } from '$lib/tauri-bindings'
  import { isEntitled } from '$lib/stores/entitlements.svelte'
  import { t } from '$lib/i18n/t.svelte'

  let {
    feature,
    class: className,
  }: {
    /** When set, the badge shows a locked style while the feature is off. */
    feature?: ProFeature
    class?: string
  } = $props()

  const locked = $derived(feature !== undefined && !isEntitled(feature))
</script>

<span
  data-slot="pro-badge"
  data-locked={locked || undefined}
  title={locked ? t('pro.lockedHint') : undefined}
  class={cn(
    'inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-[10px] leading-4 font-semibold tracking-wide uppercase select-none',
    locked
      ? 'border-foreground/15 text-muted-foreground bg-transparent'
      : 'border-primary/30 bg-primary/15 text-primary',
    className,
  )}
>
  {#if locked}
    <LockIcon class="size-2.5" aria-hidden="true" />
  {/if}
  {t('pro.badge')}
</span>
