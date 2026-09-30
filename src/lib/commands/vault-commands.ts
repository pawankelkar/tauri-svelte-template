import { hasVault } from '$lib/stores/vault.svelte'
import {
  setCreateVaultOpen,
  setVaultSwitcherOpen,
} from '$lib/stores/overlays.svelte'
import {
  backupNow,
  closeVault,
  initBackups,
  pickAndOpenVault,
  reindexVault,
} from '$lib/vault/vault-actions'
import { registerCommands, type AppCommand } from './registry.svelte'

export const VAULT_OPEN = 'vault.open'
export const VAULT_CREATE = 'vault.create'
export const VAULT_SWITCH = 'vault.switch'
export const VAULT_CLOSE = 'vault.close'
export const VAULT_REINDEX = 'vault.reindex'
export const BACKUP_NOW = 'backup.now'
export const BACKUP_INIT = 'backup.init'

const VAULT = 'commands.category.vault'
const BACKUP = 'commands.category.backup'

const vaultCommands: AppCommand[] = [
  {
    id: VAULT_OPEN,
    labelKey: 'commands.vault.open',
    category: VAULT,
    keywords: ['folder'],
    run: () => {
      void pickAndOpenVault()
    },
  },
  {
    id: VAULT_CREATE,
    labelKey: 'commands.vault.create',
    category: VAULT,
    keywords: ['new'],
    run: () => setCreateVaultOpen(true),
  },
  {
    id: VAULT_SWITCH,
    labelKey: 'commands.vault.switch',
    category: VAULT,
    keywords: ['recent'],
    run: () => setVaultSwitcherOpen(true),
  },
  {
    id: VAULT_CLOSE,
    labelKey: 'commands.vault.close',
    category: VAULT,
    when: 'vaultOpen',
    isEnabled: hasVault,
    run: () => {
      void closeVault()
    },
  },
  {
    id: VAULT_REINDEX,
    labelKey: 'commands.vault.reindex',
    category: VAULT,
    keywords: ['rebuild', 'index', 'search'],
    when: 'vaultOpen',
    isEnabled: hasVault,
    run: () => {
      void reindexVault()
    },
  },
  {
    id: BACKUP_NOW,
    labelKey: 'commands.backup.now',
    category: BACKUP,
    shortcut: 'mod+alt+b',
    allowInInput: true,
    keywords: ['snapshot', 'git', 'commit'],
    when: 'vaultOpen',
    isEnabled: hasVault,
    run: () => {
      void backupNow()
    },
  },
  {
    id: BACKUP_INIT,
    labelKey: 'commands.backup.init',
    category: BACKUP,
    keywords: ['git', 'snapshot'],
    when: 'vaultOpen',
    isEnabled: hasVault,
    run: () => {
      void initBackups()
    },
  },
]

export function registerVaultCommands(): void {
  registerCommands(vaultCommands)
}
