<script lang="ts">
  import MonitorIcon from '@lucide/svelte/icons/monitor'
  import {
    getThemeMode,
    setThemeMode,
    getProfile,
    getUserPresets,
  } from '$lib/stores/theme.svelte'
  import { deriveTokensForProfile } from '$lib/theme/presets'
  import { applyTokens } from '$lib/theme/apply'
  import type { ThemeMode } from '$lib/stores/preferences-schema'
  import { t } from '$lib/i18n/t.svelte'

  // Each card previews a profile by applying its derived tokens to the
  // card's own subtree — never to the document. The System card is a static
  // diagonal split showing both profiles at once: mirroring the current OS
  // mode instead would make it look identical to its Light or Dark neighbor.
  let lightEl = $state<HTMLElement | null>(null)
  let darkEl = $state<HTMLElement | null>(null)
  let splitLightEl = $state<HTMLElement | null>(null)
  let splitDarkEl = $state<HTMLElement | null>(null)

  $effect(() => {
    const tokens = deriveTokensForProfile(
      getProfile('light'),
      'light',
      getUserPresets(),
    )
    for (const el of [lightEl, splitLightEl]) if (el) applyTokens(tokens, el)
  })

  $effect(() => {
    const tokens = deriveTokensForProfile(
      getProfile('dark'),
      'dark',
      getUserPresets(),
    )
    for (const el of [darkEl, splitDarkEl]) if (el) applyTokens(tokens, el)
  })

  const CARDS: { value: ThemeMode; labelKey: string }[] = [
    { value: 'system', labelKey: 'preferences.appearance.themeSystem' },
    { value: 'light', labelKey: 'preferences.appearance.themeLight' },
    { value: 'dark', labelKey: 'preferences.appearance.themeDark' },
  ]
</script>

{#snippet mock()}
  <!-- Mini window mockup — every colour resolves against the tokens applied
       inline on the enclosing preview element, not the document theme. -->
  <div class="flex h-[4.5rem] flex-col" style="background: var(--sd-bg-base)">
    <div
      class="flex items-center gap-1 border-b px-1.5 py-1"
      style="background: var(--sd-bg-surface); border-color: var(--sd-border)"
    >
      {#each [0, 1, 2] as i (i)}
        <span class="size-1 rounded-full" style="background: var(--sd-text-dim)"
        ></span>
      {/each}
    </div>
    <div class="flex min-h-0 flex-1">
      <div
        class="flex w-[26%] flex-col gap-1 border-r p-1.5"
        style="background: var(--sd-bg-surface); border-color: var(--sd-border)"
      >
        {#each [0, 1, 2] as i (i)}
          <span
            class="h-[3px] rounded-[1px]"
            style="background: var(--sd-text-dim)"
          ></span>
        {/each}
      </div>
      <div class="flex flex-1 flex-col gap-1 p-1.5">
        <div
          class="h-[4px] w-[55%] rounded-[1px]"
          style="background: var(--sd-text)"
        ></div>
        <div
          class="h-[3px] w-[90%] rounded-[1px]"
          style="background: var(--sd-text-muted)"
        ></div>
        <div
          class="h-[3px] w-[65%] rounded-[1px]"
          style="background: var(--sd-text-muted)"
        ></div>
        <div
          class="mt-auto h-2 w-8 rounded-[2px]"
          style="background: var(--sd-accent)"
        ></div>
      </div>
    </div>
  </div>
{/snippet}

<div class="grid max-w-lg grid-cols-3 gap-2" role="radiogroup">
  {#each CARDS as card (card.value)}
    <button
      type="button"
      role="radio"
      aria-checked={getThemeMode() === card.value}
      class="flex flex-col gap-1.5 rounded-lg border p-1.5 text-left transition-colors {getThemeMode() ===
      card.value
        ? 'border-ring ring-ring/50 ring-[2px]'
        : 'hover:bg-accent'}"
      onclick={() => setThemeMode(card.value)}
    >
      <div class="relative overflow-hidden rounded-md border">
        {#if card.value === 'system'}
          <div bind:this={splitLightEl}>{@render mock()}</div>
          <div
            class="absolute inset-0 [clip-path:polygon(100%_0,100%_100%,0_100%)]"
            bind:this={splitDarkEl}
          >
            {@render mock()}
          </div>
          <span
            class="bg-popover text-muted-foreground absolute top-1 right-1 flex size-5 items-center justify-center rounded-full border"
          >
            <MonitorIcon class="size-3" />
          </span>
        {:else if card.value === 'light'}
          <div bind:this={lightEl}>{@render mock()}</div>
        {:else}
          <div bind:this={darkEl}>{@render mock()}</div>
        {/if}
      </div>
      <span
        class="text-center text-xs font-semibold {getThemeMode() === card.value
          ? 'text-foreground'
          : 'text-muted-foreground'}"
      >
        {t(card.labelKey)}
      </span>
    </button>
  {/each}
</div>
