<script lang="ts">
  import type { TextPart } from '$lib/tauri-bindings'
  import { cn } from '$lib/utils'

  // Rust splits the text into runs, so there are no offsets to map here.
  let { parts, class: className }: { parts: TextPart[]; class?: string } =
    $props()
</script>

<span class={className}>
  {#each parts as part, i (i)}
    {#if part.highlight}
      <mark class={cn('text-foreground rounded-[2px] bg-yellow-400/30 px-px')}
        >{part.text}</mark
      >
    {:else}
      {part.text}
    {/if}
  {/each}
</span>
