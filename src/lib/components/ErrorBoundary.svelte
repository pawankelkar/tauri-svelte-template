<script lang="ts">
  import type { Snippet } from 'svelte'
  import { Button } from '$lib/components/ui/button'
  import { logger } from '$lib/logger'
  import { toast } from '$lib/stores/toast'
  import { t } from '$lib/i18n/t.svelte'

  let { children }: { children: Snippet } = $props()

  function handleError(error: unknown): void {
    logger.error('Uncaught render error', error)

    // Phase 8 seam — crash recovery. Once src-tauri/src/commands/recovery.rs
    // lands, report the crash here (fire-and-forget) so the next boot can
    // detect it and start in a degraded-but-safe mode:
    //   void commands.saveEmergencyData({ message: describe(error) })
  }

  function describe(error: unknown): string {
    return error instanceof Error
      ? `${error.name}: ${error.message}\n${error.stack ?? ''}`
      : String(error)
  }

  async function copyDetails(error: unknown): Promise<void> {
    try {
      await navigator.clipboard.writeText(describe(error))
      toast.success(t('errorBoundary.copied'))
    } catch {
      toast.error(t('errorBoundary.copyFailed'))
    }
  }
</script>

<!--
  Wraps the main content area only — never the title bar or the global overlays.
  This app draws its own window controls, so a boundary around everything would
  replace the only way to close the window when the fallback renders.

  Note: <svelte:boundary> catches errors thrown during render and in effects.
  It does NOT catch errors thrown from event handlers — those are ordinary
  rejections and need their own try/catch at the call site.
-->
<svelte:boundary onerror={(error) => handleError(error)}>
  {@render children()}

  {#snippet failed(error, _reset)}
    <div class="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <h2 class="text-lg font-semibold">{t('errorBoundary.title')}</h2>
      <p class="text-muted-foreground max-w-md text-sm">
        {error instanceof Error ? error.message : String(error)}
      </p>
      <div class="flex gap-2">
        <Button variant="outline" onclick={() => copyDetails(error)}>
          {t('errorBoundary.copyDetails')}
        </Button>
        <!--
          A full reload re-runs main.ts and re-hydrates from disk, which
          recovers from more states than `_reset()` (a soft re-render of the
          boundary's children) would. `_reset` is available if a lighter
          "Try again" action fits your app better.
        -->
        <Button onclick={() => location.reload()}>
          {t('errorBoundary.reload')}
        </Button>
      </div>
    </div>
  {/snippet}
</svelte:boundary>
