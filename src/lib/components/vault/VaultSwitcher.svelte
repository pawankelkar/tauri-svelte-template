<script lang="ts">
  import LibraryIcon from '@lucide/svelte/icons/library'
  import CheckIcon from '@lucide/svelte/icons/check'
  import XIcon from '@lucide/svelte/icons/x'
  import FolderOpenIcon from '@lucide/svelte/icons/folder-open'
  import FolderPlusIcon from '@lucide/svelte/icons/folder-plus'
  import CircleDotIcon from '@lucide/svelte/icons/circle-dot'
  import * as Command from '$lib/components/ui/command'
  import type { VaultInfo } from '$lib/tauri-bindings'
  import { getCurrentVault, getRecentVaults } from '$lib/stores/vault.svelte'
  import {
    isVaultSwitcherOpen,
    setCreateVaultOpen,
    setVaultSwitcherOpen,
  } from '$lib/stores/overlays.svelte'
  import {
    closeVault,
    forgetVaultById,
    pickAndOpenVault,
    switchToVault,
  } from '$lib/vault/vault-actions'
  import { confirm } from '$lib/stores/confirm.svelte'
  import { formatCombo } from '$lib/commands'
  import { t } from '$lib/i18n/t.svelte'

  const ACTION_OPEN = '\u0000open'
  const ACTION_CREATE = '\u0000create'
  const ACTION_CLOSE = '\u0000close'

  const current = $derived(getCurrentVault())
  const vaults = $derived(getRecentVaults())
  let selected = $state('')

  function close(): void {
    setVaultSwitcherOpen(false)
    selected = ''
  }

  function run(value: string): void {
    close()
    switch (value) {
      case ACTION_OPEN:
        void pickAndOpenVault()
        return
      case ACTION_CREATE:
        setCreateVaultOpen(true)
        return
      case ACTION_CLOSE:
        void closeVault()
        return
      default:
        void switchToVault(value)
    }
  }

  async function forget(vault: VaultInfo): Promise<void> {
    const proceed = await confirm({
      titleKey: 'vault.forget.title',
      titleOptions: { name: vault.name },
      descriptionKey: 'vault.forget.description',
      confirmKey: 'vault.forget.confirm',
      cancelKey: 'vault.forget.cancel',
      destructive: true,
    })
    if (proceed) await forgetVaultById(vault.id)
  }

  function onInputKeydown(event: KeyboardEvent): void {
    // mod+Backspace forgets the highlighted vault, as in a browser's history.
    if (event.key !== 'Backspace' || !(event.metaKey || event.ctrlKey)) return
    const vault = vaults.find((v) => v.id === selected)
    if (!vault) return
    event.preventDefault()
    void forget(vault)
  }
</script>

<Command.Dialog
  open={isVaultSwitcherOpen()}
  onOpenChange={(open) => (open ? setVaultSwitcherOpen(true) : close())}
  bind:value={selected}
  title={t('vault.switcher.title')}
  description={t('vault.switcher.description')}
>
  <Command.Input
    placeholder={t('vault.switcher.placeholder')}
    onkeydown={onInputKeydown}
  />
  <Command.List class="max-h-96">
    <Command.Empty>{t('vault.switcher.empty')}</Command.Empty>
    {#if vaults.length}
      <Command.Group heading={t('vault.switcher.recent')}>
        {#each vaults as vault (vault.id)}
          <Command.Item
            value={vault.id}
            keywords={[vault.name, vault.path]}
            onSelect={() => run(vault.id)}
          >
            <LibraryIcon class="text-muted-foreground" />
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate">{vault.name}</span>
              <span class="text-muted-foreground truncate text-xs"
                >{vault.path}</span
              >
            </span>
            {#if current?.id === vault.id}
              <CheckIcon
                class="text-primary"
                aria-label={t('vault.switcher.current')}
              />
            {:else}
              <button
                type="button"
                class="text-muted-foreground hover:text-foreground hover:bg-accent rounded p-0.5"
                aria-label={t('vault.forget.action', { name: vault.name })}
                title={t('vault.forget.hint', {
                  key: formatCombo('mod+backspace'),
                })}
                onpointerdown={(e) => e.stopPropagation()}
                onclick={(e) => {
                  e.stopPropagation()
                  void forget(vault)
                }}
              >
                <XIcon class="size-3.5" />
              </button>
            {/if}
          </Command.Item>
        {/each}
      </Command.Group>
    {/if}
    <Command.Group heading={t('vault.switcher.actions')}>
      <Command.Item
        value={ACTION_OPEN}
        keywords={[t('vault.open.action')]}
        onSelect={() => run(ACTION_OPEN)}
      >
        <FolderOpenIcon class="text-muted-foreground" />
        {t('vault.open.action')}
      </Command.Item>
      <Command.Item
        value={ACTION_CREATE}
        keywords={[t('vault.create.action')]}
        onSelect={() => run(ACTION_CREATE)}
      >
        <FolderPlusIcon class="text-muted-foreground" />
        {t('vault.create.action')}
      </Command.Item>
      {#if current}
        <Command.Item
          value={ACTION_CLOSE}
          keywords={[t('vault.close.action')]}
          onSelect={() => run(ACTION_CLOSE)}
        >
          <CircleDotIcon class="text-muted-foreground" />
          {t('vault.close.action')}
        </Command.Item>
      {/if}
    </Command.Group>
  </Command.List>
</Command.Dialog>
