<script lang="ts">
  import { Toaster } from '$lib/components/ui/sonner'
</script>

<!--
  Mounted once, globally, in App.svelte. The vendored `ui/sonner` component
  reads the resolved light/dark mode from `theme.svelte.ts`, so no theme prop is
  needed here.
-->
<Toaster richColors closeButton />
