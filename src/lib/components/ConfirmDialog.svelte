<script lang="ts">
  import * as AlertDialog from '$lib/components/ui/alert-dialog'
  import { buttonVariants } from '$lib/components/ui/button'
  import {
    getConfirmRequest,
    confirmAccept,
    confirmCancel,
  } from '$lib/stores/confirm.svelte'
  import { t } from '$lib/i18n/t.svelte'
  import { cn } from '$lib/utils'

  const request = $derived(getConfirmRequest())
</script>

<!--
  `open` is driven entirely by the store rather than by the AlertDialog's own
  close-on-click behaviour, so every dismissal path — action button, cancel
  button, Escape, overlay click — settles the pending promise exactly once.
-->
<AlertDialog.Root
  open={request !== null}
  onOpenChange={(open) => {
    if (!open) confirmCancel()
  }}
>
  {#if request}
    <AlertDialog.Content>
      <AlertDialog.Header>
        <AlertDialog.Title>
          {t(request.titleKey, request.titleOptions)}
        </AlertDialog.Title>
        {#if request.descriptionKey}
          <AlertDialog.Description>
            {t(request.descriptionKey, request.descriptionOptions)}
          </AlertDialog.Description>
        {/if}
      </AlertDialog.Header>
      <AlertDialog.Footer>
        <AlertDialog.Cancel onclick={confirmCancel}>
          {t(request.cancelKey ?? 'confirm.cancel')}
        </AlertDialog.Cancel>
        <AlertDialog.Action
          onclick={confirmAccept}
          class={cn(
            request.destructive && buttonVariants({ variant: 'destructive' }),
          )}
        >
          {t(request.confirmKey ?? 'confirm.confirm')}
        </AlertDialog.Action>
      </AlertDialog.Footer>
    </AlertDialog.Content>
  {/if}
</AlertDialog.Root>
