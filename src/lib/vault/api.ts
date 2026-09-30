/**
 * Thin, typed wrappers over the P1 vault commands.
 *
 * Each call unwraps the generated `Result`, so a failure throws the plain
 * `CoreError` (test it with `isCoreErrorKind` from `$lib/core-error`). Every
 * argument is a primitive, which is also why these live outside
 * `src/lib/stores/`: nothing here can leak a rune proxy across IPC.
 *
 * Rust owns all file IO, parsing, link resolution and search; the UI only
 * ever reaches the vault through these.
 */
import {
  commands,
  unwrapResult,
  type Backlink,
  type BackupStatus,
  type DbEncryption,
  type Heading,
  type IndexStatus,
  type LinkTarget,
  type Note,
  type NoteRef,
  type QuickOpenItem,
  type RenameResult,
  type SearchHit,
  type SnapshotInfo,
  type TreeNode,
  type VaultInfo,
  type WriteResult,
} from '$lib/tauri-bindings'

// --- Vault lifecycle --------------------------------------------------------

export async function listVaults(): Promise<VaultInfo[]> {
  return unwrapResult(await commands.vaultList())
}

export async function currentVault(): Promise<VaultInfo | null> {
  return unwrapResult(await commands.vaultCurrent())
}

export async function createVault(
  parentDir: string,
  name: string,
  encryption: DbEncryption,
): Promise<VaultInfo> {
  return unwrapResult(await commands.vaultCreate(parentDir, name, encryption))
}

export async function openVault(path: string): Promise<VaultInfo> {
  return unwrapResult(await commands.vaultOpen(path))
}

export async function openVaultById(id: string): Promise<VaultInfo> {
  return unwrapResult(await commands.vaultOpenById(id))
}

export async function closeVault(): Promise<void> {
  unwrapResult(await commands.vaultClose())
}

export async function forgetVault(id: string): Promise<void> {
  unwrapResult(await commands.vaultForget(id))
}

// --- Files ------------------------------------------------------------------

export async function listTree(): Promise<TreeNode[]> {
  return unwrapResult(await commands.listTree())
}

export async function readNote(path: string): Promise<Note> {
  return unwrapResult(await commands.readNote(path))
}

export async function writeNote(
  path: string,
  content: string,
  expectedHash: string | null,
): Promise<WriteResult> {
  return unwrapResult(await commands.writeNote(path, content, expectedHash))
}

export async function createNote(
  folder: string | null,
  title: string | null,
): Promise<NoteRef> {
  return unwrapResult(await commands.createNote(folder, title))
}

export async function createFolder(path: string): Promise<void> {
  unwrapResult(await commands.createFolder(path))
}

export async function renamePath(
  from: string,
  to: string,
): Promise<RenameResult> {
  return unwrapResult(await commands.renamePath(from, to))
}

export async function trashPath(path: string): Promise<void> {
  unwrapResult(await commands.trashPath(path))
}

// --- Links, outline, search -------------------------------------------------

export async function getBacklinks(path: string): Promise<Backlink[]> {
  return unwrapResult(await commands.getBacklinks(path))
}

export async function getOutline(content: string): Promise<Heading[]> {
  return unwrapResult(await commands.getOutline(content))
}

export async function resolveLink(
  fromPath: string,
  target: string,
): Promise<LinkTarget> {
  return unwrapResult(await commands.resolveLink(fromPath, target))
}

export async function quickOpen(
  query: string,
  limit: number,
): Promise<QuickOpenItem[]> {
  return unwrapResult(await commands.quickOpen(query, limit))
}

export async function searchFulltext(
  query: string,
  limit: number,
): Promise<SearchHit[]> {
  return unwrapResult(await commands.searchFulltext(query, limit))
}

export async function indexStatus(): Promise<IndexStatus> {
  return unwrapResult(await commands.indexStatus())
}

export async function reindex(): Promise<void> {
  unwrapResult(await commands.reindex())
}

// --- Backups ----------------------------------------------------------------

export async function backupStatus(): Promise<BackupStatus> {
  return unwrapResult(await commands.backupStatus())
}

export async function backupInit(): Promise<BackupStatus> {
  return unwrapResult(await commands.backupInit())
}

export async function backupNow(
  message: string | null,
): Promise<SnapshotInfo | null> {
  return unwrapResult(await commands.backupNow(message))
}
