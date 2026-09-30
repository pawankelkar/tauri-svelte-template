<script lang="ts">
  import FolderOpenIcon from '@lucide/svelte/icons/folder-open'
  import LockIcon from '@lucide/svelte/icons/lock'
  import * as Dialog from '$lib/components/ui/dialog'
  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import { Label } from '$lib/components/ui/label'
  import { Switch } from '$lib/components/ui/switch'
  import {
    isCreateVaultOpen,
    setCreateVaultOpen,
  } from '$lib/stores/overlays.svelte'
  import { createVault, pickParentFolder } from '$lib/vault/vault-actions'
  import { validateName } from '$lib/vault/paths'
  import { t } from '$lib/i18n/t.svelte'

  let name = $state('')
  let parentDir = $state<string | null>(null)
  // On by default: the index holds note text, so it is encrypted at rest
  // with a key kept in the OS keychain unless the user opts out.
  let encrypt = $state(true)
  let busy = $state(false)
  let error = $state<string | null>(null)

  const nameProblem = $derived(name.trim() ? validateName(name) : null)
  const canSubmit = $derived(
    !busy && name.trim() !== '' && nameProblem === null && parentDir !== null,
  )

  function reset(): void {
    name = ''
    parentDir = null
    encrypt = true
    busy = false
    error = null
  }

  function onOpenChange(open: boolean): void {
    if (busy) return
    setCreateVaultOpen(open)
    if (!open) reset()
  }

  async function choose(): Promise<void> {
    const picked = await pickParentFolder()
    if (picked) parentDir = picked
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    if (!canSubmit || !parentDir) return
    busy = true
    error = null
    const problem = await createVault(
      parentDir,
      name.trim(),
      encrypt ? 'keychain' : 'none',
    )
    busy = false
    if (problem) {
      error = problem
      return
    }
    setCreateVaultOpen(false)
    reset()
  }
</script>

<Dialog.Root open={isCreateVaultOpen()} {onOpenChange}>
  <Dialog.Content class="max-w-md">
    <Dialog.Header>
      <Dialog.Title>{t('vault.create.title')}</Dialog.Title>
      <Dialog.Description>{t('vault.create.description')}</Dialog.Description>
    </Dialog.Header>

    <form class="flex flex-col gap-4" onsubmit={submit}>
      <div class="flex flex-col gap-1.5">
        <Label for="create-vault-name">{t('vault.create.nameLabel')}</Label>
        <Input
          id="create-vault-name"
          bind:value={name}
          placeholder={t('vault.create.namePlaceholder')}
          aria-invalid={nameProblem !== null}
          autocomplete="off"
        />
        {#if nameProblem}
          <p class="text-destructive text-xs" role="alert">{t(nameProblem)}</p>
        {/if}
      </div>

      <div class="flex flex-col gap-1.5">
        <Label for="create-vault-parent">{t('vault.create.parentLabel')}</Label>
        <div class="flex gap-2">
          <Input
            id="create-vault-parent"
            value={parentDir ?? ''}
            readonly
            placeholder={t('vault.create.parentPlaceholder')}
            class="min-w-0 flex-1"
            onclick={() => void choose()}
          />
          <Button type="button" variant="outline" onclick={() => void choose()}>
            <FolderOpenIcon />
            {t('vault.create.choose')}
          </Button>
        </div>
      </div>

      <div class="flex items-start justify-between gap-4 rounded-lg border p-3">
        <div class="space-y-1">
          <Label for="create-vault-encrypt" class="flex items-center gap-1.5">
            <LockIcon class="size-3.5" aria-hidden="true" />
            {t('vault.create.encryptLabel')}
          </Label>
          <p class="text-muted-foreground text-xs">
            {t('vault.create.encryptDescription')}
          </p>
        </div>
        <Switch
          id="create-vault-encrypt"
          checked={encrypt}
          onCheckedChange={(v) => (encrypt = v)}
        />
      </div>

      {#if error}
        <p class="text-destructive text-sm" role="alert">{error}</p>
      {/if}

      <Dialog.Footer>
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onclick={() => onOpenChange(false)}
        >
          {t('vault.create.cancel')}
        </Button>
        <Button type="submit" disabled={!canSubmit}>
          {busy ? t('vault.create.creating') : t('vault.create.submit')}
        </Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
