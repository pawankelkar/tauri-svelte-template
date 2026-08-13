<script lang="ts">
  import { cn } from '$lib/utils.js'
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    class: className,
    children,
    ...restProps
  }: HTMLAttributes<HTMLElement> & { children?: Snippet } = $props()
</script>

<!--
  The background is mixed from `foreground`, not a surface token, so the key
  always sits one step above whatever surface it is placed on. `muted` and
  `card` resolve to the same colour, so `bg-muted` would be invisible on a card.
-->
<kbd
  data-slot="kbd"
  class={cn(
    'bg-foreground/10 border-foreground/20 text-foreground shadow-xs rounded border px-1.5 py-0.5 font-mono text-xs font-medium',
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</kbd>
