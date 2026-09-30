<script lang="ts">
  import { tick } from 'svelte'
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right'
  import FolderIcon from '@lucide/svelte/icons/folder'
  import FolderOpenIcon from '@lucide/svelte/icons/folder-open'
  import FileTextIcon from '@lucide/svelte/icons/file-text'
  import FileIcon from '@lucide/svelte/icons/file'
  import type { TreeNode } from '$lib/tauri-bindings'
  import { getTree } from '$lib/stores/vault.svelte'
  import {
    expandAncestors,
    getTreeSelection,
    isExpanded,
    setExpanded,
    setTreeSelection,
    toggleExpanded,
  } from '$lib/stores/tree-state.svelte'
  import { renameEntry, trashEntry } from '$lib/stores/notes.svelte'
  import { getActiveTab, keepTab } from '$lib/workspace/tabs.svelte'
  import { notePathOfTab, openNote } from '$lib/workspace/open-note'
  import { getTreeRenameRequest } from '$lib/workspace/rename-requests.svelte'
  import { setContextKey } from '$lib/commands/context-keys.svelte'
  import { showContextMenu } from '$lib/context-menu'
  import {
    noteStem,
    parentOf,
    renameTarget,
    validateName,
  } from '$lib/vault/paths'
  import { entryMenu } from './file-tree-actions'
  import { t } from '$lib/i18n/t.svelte'
  import { cn } from '$lib/utils'

  interface Row {
    node: TreeNode
    depth: number
  }

  function flatten(nodes: TreeNode[], depth: number, out: Row[]): Row[] {
    for (const node of nodes) {
      out.push({ node, depth })
      if (node.kind === 'folder' && isExpanded(node.path)) {
        flatten(node.children, depth + 1, out)
      }
    }
    return out
  }

  const rows = $derived(flatten(getTree(), 0, []))
  const activePath = $derived(notePathOfTab(getActiveTab()))
  const selected = $derived(getTreeSelection())

  let container = $state<HTMLDivElement | null>(null)

  // The active note is where the keyboard starts, and its folders open so
  // it can be seen.
  $effect(() => {
    if (!activePath) return
    expandAncestors(activePath)
    setTreeSelection(activePath)
  })

  function displayName(node: TreeNode): string {
    return node.kind === 'note' ? noteStem(node.path) : node.name
  }

  function focusRow(path: string): void {
    setTreeSelection(path)
    void tick().then(() => {
      const el = container?.querySelector<HTMLElement>(
        `[data-path="${CSS.escape(path)}"]`,
      )
      el?.focus()
      el?.scrollIntoView({ block: 'nearest' })
    })
  }

  function activate(node: TreeNode, keep: boolean): void {
    setTreeSelection(node.path)
    if (node.kind === 'folder') {
      toggleExpanded(node.path)
      return
    }
    if (node.kind !== 'note') return
    const id = openNote(node.path, { preview: !keep })
    if (id && keep) keepTab(id)
  }

  function onRowClick(event: MouseEvent, node: TreeNode): void {
    const mod = event.metaKey || event.ctrlKey
    activate(node, mod)
  }

  function onRowDoubleClick(node: TreeNode): void {
    if (node.kind !== 'note') return
    const id = openNote(node.path)
    if (id) keepTab(id)
  }

  function onContextMenu(event: MouseEvent, node: TreeNode | null): void {
    event.preventDefault()
    event.stopPropagation()
    if (node) setTreeSelection(node.path)
    void showContextMenu(entryMenu(node))
  }

  function onKeydown(event: KeyboardEvent): void {
    if (renaming) return
    if (rows.length === 0) return
    const index = rows.findIndex((r) => r.node.path === selected)
    const current = index === -1 ? undefined : rows[index]
    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault()
        const next = rows[Math.min(index + 1, rows.length - 1)] ?? rows[0]
        if (next) focusRow(next.node.path)
        break
      }
      case 'ArrowUp': {
        event.preventDefault()
        const prev = rows[Math.max(index - 1, 0)]
        if (prev) focusRow(prev.node.path)
        break
      }
      case 'Home':
        event.preventDefault()
        focusRow(rows[0]!.node.path)
        break
      case 'End':
        event.preventDefault()
        focusRow(rows[rows.length - 1]!.node.path)
        break
      case 'ArrowRight': {
        if (!current || current.node.kind !== 'folder') return
        event.preventDefault()
        if (!isExpanded(current.node.path)) setExpanded(current.node.path, true)
        else if (current.node.children[0])
          focusRow(current.node.children[0].path)
        break
      }
      case 'ArrowLeft': {
        if (!current) return
        event.preventDefault()
        if (current.node.kind === 'folder' && isExpanded(current.node.path)) {
          setExpanded(current.node.path, false)
        } else {
          const parent = parentOf(current.node.path)
          if (parent) focusRow(parent)
        }
        break
      }
      case 'Enter':
        if (!current) return
        event.preventDefault()
        activate(current.node, true)
        break
      case ' ':
        if (!current) return
        event.preventDefault()
        activate(current.node, false)
        break
      case 'Delete':
      case 'Backspace':
        if (!current) return
        if (event.key === 'Backspace' && !(event.metaKey || event.ctrlKey))
          return
        event.preventDefault()
        void trashEntry(current.node.path)
        break
    }
  }

  // --- Inline rename ---------------------------------------------------------

  let renaming = $state<string | null>(null)
  let draft = $state('')
  let renameError = $state<string | null>(null)
  let lastRequest = 0

  $effect(() => {
    const request = getTreeRenameRequest()
    if (!request || request.seq === lastRequest) return
    lastRequest = request.seq
    const row = rows.find((r) => r.node.path === request.target)
    if (row) void startRename(row.node)
  })

  async function startRename(node: TreeNode): Promise<void> {
    expandAncestors(node.path)
    setTreeSelection(node.path)
    renaming = node.path
    draft = displayName(node)
    renameError = null
    await tick()
    const input =
      container?.querySelector<HTMLInputElement>('input[data-rename]')
    input?.focus()
    input?.select()
  }

  async function commitRename(node: TreeNode): Promise<void> {
    if (renaming !== node.path) return
    const name = draft.trim()
    if (name === displayName(node)) {
      cancelRename()
      return
    }
    const problem = validateName(name)
    if (problem) {
      renameError = t(problem)
      return
    }
    renaming = null
    const next = await renameEntry(
      node.path,
      renameTarget(node.path, name, node.kind),
    )
    focusRow(next ?? node.path)
  }

  function cancelRename(): void {
    const path = renaming
    renaming = null
    renameError = null
    if (path) focusRow(path)
  }

  function onRenameKeydown(event: KeyboardEvent, node: TreeNode): void {
    event.stopPropagation()
    if (event.key === 'Enter') {
      event.preventDefault()
      void commitRename(node)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      cancelRename()
    }
  }

  function onFocusIn(): void {
    setContextKey('fileTreeFocus', true)
  }

  function onFocusOut(event: FocusEvent): void {
    if (!container?.contains(event.relatedTarget as Node | null)) {
      setContextKey('fileTreeFocus', false)
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={container}
  class="flex min-h-full flex-col pb-6"
  oncontextmenu={(e) => onContextMenu(e, null)}
  onfocusin={onFocusIn}
  onfocusout={onFocusOut}
>
  {#if rows.length === 0}
    <p class="text-muted-foreground px-4 py-3 text-xs">{t('fileTree.empty')}</p>
  {:else}
    <div
      role="tree"
      aria-label={t('fileTree.label')}
      tabindex="-1"
      class="flex flex-col px-1.5"
      onkeydown={onKeydown}
    >
      {#each rows as { node, depth } (node.path)}
        {@const isFolder = node.kind === 'folder'}
        {@const expanded = isFolder && isExpanded(node.path)}
        {#if renaming === node.path}
          <div
            class="flex flex-col py-0.5"
            style:padding-left="{depth * 12 + 22}px"
          >
            <input
              data-rename
              bind:value={draft}
              class="border-ring bg-background h-6 rounded border px-1.5 text-sm outline-none"
              aria-label={t('fileTree.renameLabel')}
              aria-invalid={renameError !== null}
              onkeydown={(e) => onRenameKeydown(e, node)}
              onblur={() => void commitRename(node)}
            />
            {#if renameError}
              <span class="text-destructive px-1 pt-0.5 text-xs" role="alert">
                {renameError}
              </span>
            {/if}
          </div>
        {:else}
          <button
            type="button"
            role="treeitem"
            data-path={node.path}
            aria-level={depth + 1}
            aria-expanded={isFolder ? expanded : undefined}
            aria-selected={selected === node.path}
            aria-current={activePath === node.path ? 'page' : undefined}
            tabindex={selected === node.path ||
            (!selected && rows[0]?.node === node)
              ? 0
              : -1}
            class={cn(
              'hover:bg-accent/60 focus-visible:ring-ring flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-left text-sm outline-none focus-visible:ring-1',
              activePath === node.path && 'bg-accent text-accent-foreground',
              selected === node.path &&
                activePath !== node.path &&
                'bg-accent/40',
              node.kind === 'file' && 'text-muted-foreground',
            )}
            style:padding-left="{depth * 12 + 6}px"
            onclick={(e) => onRowClick(e, node)}
            ondblclick={() => onRowDoubleClick(node)}
            oncontextmenu={(e) => onContextMenu(e, node)}
          >
            {#if isFolder}
              <ChevronRightIcon
                class={cn(
                  'text-muted-foreground size-3.5 shrink-0 transition-transform',
                  expanded && 'rotate-90',
                )}
                aria-hidden="true"
              />
              {#if expanded}
                <FolderOpenIcon
                  class="text-muted-foreground size-4 shrink-0"
                  aria-hidden="true"
                />
              {:else}
                <FolderIcon
                  class="text-muted-foreground size-4 shrink-0"
                  aria-hidden="true"
                />
              {/if}
            {:else}
              <span class="size-3.5 shrink-0" aria-hidden="true"></span>
              {#if node.kind === 'note'}
                <FileTextIcon
                  class="text-muted-foreground size-4 shrink-0"
                  aria-hidden="true"
                />
              {:else}
                <FileIcon
                  class="size-4 shrink-0 opacity-60"
                  aria-hidden="true"
                />
              {/if}
            {/if}
            <span class="min-w-0 truncate">{displayName(node)}</span>
          </button>
        {/if}
      {/each}
    </div>
  {/if}
</div>
