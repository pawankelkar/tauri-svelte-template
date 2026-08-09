<script lang="ts">
  import type { Snippet } from 'svelte'
  import { t } from '$lib/i18n/t.svelte'

  /**
   * The chrome every platform titlebar shares: the drag strip, the bottom
   * border, and the centred title.
   *
   * Two details here are load-bearing and easy to lose when copied by hand:
   *
   * - `data-tauri-drag-region` sits on the bar only, NOT on the title
   *   overlay. The overlay is `pointer-events-none`, so clicks fall through
   *   to the bar and dragging works without it. Marking the overlay too
   *   would break the leading cluster: native drag regions (`app-region` in
   *   WebView2) are computed in paint order, so the overlay's full-width
   *   drag rect would re-cover the leading cluster's `no-drag` rect — a fast
   *   double-click on the left titlebar buttons would maximize the window.
   * - The title is absolutely positioned and `pointer-events-none`. Centring
   *   it with flexbox instead would shift it whenever the leading or trailing
   *   cluster changes width — traffic lights on macOS, window buttons on
   *   Windows — and it would swallow clicks meant for the drag region.
   *
   * `leading` and `trailing` are whole clusters, padding included, because the
   * variants disagree about it: macOS pads only the right, Windows only the
   * left, Linux both.
   */

  let {
    title,
    leading,
    trailing,
  }: {
    title?: string
    leading?: Snippet
    trailing?: Snippet
  } = $props()

  const displayTitle = $derived(title ?? t('titlebar.default'))
</script>

<div
  data-tauri-drag-region
  class="bg-background relative flex h-8 w-full shrink-0 items-center justify-between border-b"
>
  {#if leading}
    {@render leading()}
  {/if}

  <div
    class="pointer-events-none absolute inset-0 flex items-center justify-center"
  >
    <span class="text-muted-foreground text-xs font-medium">{displayTitle}</span
    >
  </div>

  {#if trailing}
    {@render trailing()}
  {/if}
</div>
