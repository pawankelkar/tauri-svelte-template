/**
 * What the file tree's rows and context menu do. Kept out of the component
 * so the menu contents and the "new folder" naming are testable.
 */
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import type { TreeNode } from '$lib/tauri-bindings'
import type { ContextMenuEntry } from '$lib/context-menu'
import * as api from '$lib/vault/api'
import { joinPath, parentOf } from '$lib/vault/paths'
import { describeError } from '$lib/core-error'
import { createAndOpenNote, trashEntry } from '$lib/stores/notes.svelte'
import {
  findTreeNode,
  getCurrentVault,
  getTree,
  refreshTree,
} from '$lib/stores/vault.svelte'
import { setExpanded, setTreeSelection } from '$lib/stores/tree-state.svelte'
import { requestTreeRename } from '$lib/workspace/rename-requests.svelte'
import { toast } from '$lib/stores/toast'
import i18n from '$lib/i18n/config'
import { logger } from '$lib/logger'
import { getPlatform } from '$lib/hooks/use-platform.svelte'

/** The folder new entries go in for a right-click on `node` (root for none). */
export function targetFolder(node: TreeNode | null): string {
  if (!node) return ''
  return node.kind === 'folder' ? node.path : parentOf(node.path)
}

/** `base`, or `base 2`, `base 3`… — the first name free in `siblings`. */
export function uniqueName(base: string, siblings: readonly string[]): string {
  const taken = new Set(siblings.map((s) => s.toLowerCase()))
  if (!taken.has(base.toLowerCase())) return base
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
}

function childrenOf(folder: string): TreeNode[] {
  if (!folder) return getTree()
  return findTreeNode(folder)?.children ?? []
}

export async function newNoteIn(folder: string): Promise<void> {
  if (folder) setExpanded(folder, true)
  const path = await createAndOpenNote(folder || null, null)
  if (path) setTreeSelection(path)
}

/** Creates an "Untitled folder" and starts renaming it in place. */
export async function newFolderIn(folder: string): Promise<void> {
  const name = uniqueName(
    i18n.t('fileTree.untitledFolder'),
    childrenOf(folder).map((c) => c.name),
  )
  const path = joinPath(folder, name)
  try {
    await api.createFolder(path)
  } catch (e) {
    toast.error(i18n.t('fileTree.createFolderFailed'), {
      description: describeError(e),
    })
    return
  }
  if (folder) setExpanded(folder, true)
  await refreshTree()
  setTreeSelection(path)
  requestTreeRename(path)
}

/** The absolute path of a vault entry, in the OS's own separators. */
export function absolutePath(path: string): string | null {
  const vault = getCurrentVault()
  if (!vault) return null
  const sep = vault.path.includes('\\') ? '\\' : '/'
  const root = vault.path.replace(/[\\/]+$/, '')
  return path ? `${root}${sep}${path.split('/').join(sep)}` : root
}

export async function revealEntry(path: string): Promise<void> {
  const absolute = absolutePath(path)
  if (!absolute) return
  try {
    await revealItemInDir(absolute)
  } catch (e) {
    logger.warn('Revealing the file failed', e)
    toast.error(i18n.t('fileTree.revealFailed'))
  }
}

export async function copyEntryPath(path: string): Promise<void> {
  const absolute = absolutePath(path)
  if (!absolute) return
  try {
    await navigator.clipboard.writeText(absolute)
    toast.success(i18n.t('fileTree.pathCopied'))
  } catch (e) {
    logger.warn('Copying the path failed', e)
  }
}

function revealLabelKey(): string {
  switch (getPlatform()) {
    case 'macos':
      return 'fileTree.menu.revealMac'
    case 'windows':
      return 'fileTree.menu.revealWindows'
    default:
      return 'fileTree.menu.revealOther'
  }
}

/** The right-click menu for a row (or for the empty area below the rows). */
export function entryMenu(node: TreeNode | null): ContextMenuEntry[] {
  const folder = targetFolder(node)
  const entries: ContextMenuEntry[] = [
    {
      id: 'tree-new-note',
      labelKey: 'fileTree.menu.newNote',
      action: () => void newNoteIn(folder),
    },
    {
      id: 'tree-new-folder',
      labelKey: 'fileTree.menu.newFolder',
      action: () => void newFolderIn(folder),
    },
  ]
  if (!node) return entries
  entries.push(
    { separator: true },
    {
      id: 'tree-rename',
      labelKey: 'fileTree.menu.rename',
      action: () => requestTreeRename(node.path),
    },
    {
      id: 'tree-trash',
      labelKey: 'fileTree.menu.trash',
      action: () => void trashEntry(node.path),
    },
    { separator: true },
    {
      id: 'tree-reveal',
      labelKey: revealLabelKey(),
      action: () => void revealEntry(node.path),
    },
    {
      id: 'tree-copy-path',
      labelKey: 'fileTree.menu.copyPath',
      action: () => void copyEntryPath(node.path),
    },
  )
  return entries
}
