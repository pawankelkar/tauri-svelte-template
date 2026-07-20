<script lang="ts">
  import type { Snippet } from 'svelte'

  let { children }: { children?: Snippet } = $props()
</script>

<!--
  Paneforge sets `overflow: hidden` inline on the pane itself, so this wrapper
  is what provides the sidebar's own scroll region.
-->
<div class="border-border bg-muted/30 h-full overflow-auto border-r">
  {@render children?.()}
</div>
