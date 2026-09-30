<script lang="ts">
  import NotebookPenIcon from '@lucide/svelte/icons/notebook-pen'
  import FolderPlusIcon from '@lucide/svelte/icons/folder-plus'
  import FolderOpenIcon from '@lucide/svelte/icons/folder-open'
  import { Button } from '$lib/components/ui/button'
  import { Kbd } from '$lib/components/ui/kbd'
  import { OPEN_COMMAND_PALETTE, formatCommandShortcut } from '$lib/commands'
  import { toast } from '$lib/stores/toast'
  import { t } from '$lib/i18n/t.svelte'

  // Follows the user's binding; a cleared binding hides the hint rather than
  // advertising a chord that does nothing.
  const paletteShortcut = $derived(formatCommandShortcut(OPEN_COMMAND_PALETTE))

  // The translation places the chip, so word order stays right in every
  // language: split the sentence around a sentinel standing in for it.
  const SLOT = '\u0000'
  const hintParts = $derived(
    t('workspace.empty.paletteHint', { shortcut: SLOT }).split(SLOT),
  )

  function vaultsComingSoon(): void {
    toast.info(t('workspace.empty.comingSoon'))
  }
</script>

<div class="flex h-full items-center justify-center overflow-auto p-8">
  <div class="flex max-w-sm flex-col items-center text-center">
    <div
      class="bg-primary/10 text-primary mb-5 flex size-14 items-center justify-center rounded-2xl"
      aria-hidden="true"
    >
      <NotebookPenIcon class="size-7" />
    </div>
    <h2 class="text-xl font-semibold tracking-tight">
      {t('workspace.empty.title')}
    </h2>
    <p class="text-muted-foreground mt-2 text-sm text-balance">
      {t('workspace.empty.description')}
    </p>
    <div class="mt-6 flex flex-wrap justify-center gap-2">
      <Button onclick={vaultsComingSoon}>
        <FolderPlusIcon />
        {t('workspace.empty.createVault')}
      </Button>
      <Button variant="outline" onclick={vaultsComingSoon}>
        <FolderOpenIcon />
        {t('workspace.empty.openVault')}
      </Button>
    </div>
    {#if paletteShortcut}
      <p class="text-muted-foreground mt-10 text-xs">
        {hintParts[0]}<Kbd class="mx-1">{paletteShortcut}</Kbd>{hintParts[1]}
      </p>
    {/if}
  </div>
</div>
