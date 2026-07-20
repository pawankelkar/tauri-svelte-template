<script lang="ts">
  import { Button } from '$lib/components/ui/button'
  import { getPreferences } from '$lib/stores/preferences.svelte'
  import {
    buildCombo,
    fromTauriAccelerator,
    isValidGlobalShortcutCombo,
    toTauriAccelerator,
  } from '$lib/shortcuts'
  import { formatShortcut } from '$lib/platform-strings'
  import { getPlatform } from '$lib/hooks/use-platform.svelte'
  import { toast } from '$lib/stores/toast'
  import { t } from '$lib/i18n/t.svelte'
  import { commitShortcut, preferenceKeyFor } from './commit-shortcut'
  import type { ShortcutPurposeId } from './commit-shortcut'

  /**
   * `purpose` selects both the Rust-side registration slot and the preference
   * that stores it, so one picker serves every rebindable global shortcut.
   */
  let { purpose }: { purpose: ShortcutPurposeId } = $props()

  let listening = $state(false)
  let pending = $state(false)
  let error = $state<string | null>(null)

  const accelerator = $derived(
    getPreferences()[preferenceKeyFor(purpose)] as string | null,
  )

  const display = $derived.by(() => {
    if (!accelerator) return null
    const { key, modifiers } = fromTauriAccelerator(accelerator)
    return formatShortcut(getPlatform(), key, modifiers)
  })

  async function apply(next: string | null): Promise<void> {
    pending = true
    error = null
    const result = await commitShortcut(purpose, next)
    pending = false

    if (!result.ok) {
      error =
        result.reason === 'register'
          ? t('shortcutPicker.registerError')
          : t('shortcutPicker.saveError')
      toast.error(error)
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    event.preventDefault()

    if (event.key === 'Escape') {
      listening = false
      return
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      listening = false
      void apply(null)
      return
    }

    const combo = buildCombo(event)
    // Ignore modifier-only presses while the user is still assembling a combo.
    if (!isValidGlobalShortcutCombo(combo)) return

    listening = false
    void apply(toTauriAccelerator(combo))
  }

  function focusOnMount(node: HTMLElement) {
    node.focus()
  }
</script>

<div class="space-y-2">
  {#if listening}
    <input
      class="border-input ring-ring w-[240px] rounded-md border px-3 py-2 text-sm ring-2 outline-none"
      readonly
      value={t('shortcutPicker.listening')}
      onkeydown={handleKeydown}
      onblur={() => (listening = false)}
      use:focusOnMount
    />
  {:else}
    <div class="flex items-center gap-2">
      <Button
        variant="outline"
        class="w-[240px] justify-start font-mono"
        disabled={pending}
        onclick={() => (listening = true)}
      >
        {display ?? t('shortcutPicker.placeholder')}
      </Button>
      {#if display}
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onclick={() => apply(null)}
        >
          {t('shortcutPicker.clear')}
        </Button>
      {/if}
    </div>
  {/if}

  {#if error}
    <p class="text-destructive text-sm">{error}</p>
  {/if}
</div>
