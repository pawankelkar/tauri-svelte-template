<script lang="ts" module>
  /**
   * Caret and scroll position per tab, so switching tabs (which unmounts
   * the editor) returns to where you were.
   */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never rendered
  const positions = new Map<string, { head: number; scrollTop: number }>()
</script>

<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { EditorSelection } from '@codemirror/state'
  import { createNoteEditor, type NoteEditor } from '$lib/editor/note-editor'
  import {
    registerEditor,
    setCursorLine,
  } from '$lib/editor/editor-registry.svelte'
  import { syncLinkCache } from '$lib/editor/link-cache'
  import { setContextKey } from '$lib/commands/context-keys.svelte'
  import { getTreeVersion } from '$lib/stores/vault.svelte'
  import { updateDocContent, type NoteDoc } from '$lib/stores/notes.svelte'
  import { t } from '$lib/i18n/t.svelte'

  let { doc, tabId }: { doc: NoteDoc; tabId: string } = $props()

  let host: HTMLDivElement
  let editor: NoteEditor | undefined

  onMount(() => {
    const created = createNoteEditor({
      parent: host,
      content: doc.content,
      path: () => doc.path,
      onChange: (content) => updateDocContent(doc.path, content),
      onCursorLine: (line) => setCursorLine(tabId, line),
      onFocusChange: (focused) => setContextKey('editorTextFocus', focused),
      ariaLabel: t('editor.ariaLabel'),
    })
    editor = created
    const view = created.view

    const saved = positions.get(tabId)
    if (saved) {
      const head = Math.min(saved.head, view.state.doc.length)
      view.dispatch({ selection: EditorSelection.cursor(head) })
      requestAnimationFrame(() => {
        view.scrollDOM.scrollTop = saved.scrollTop
      })
    }

    const onFocusIn = () => setContextKey('editorFocus', true)
    const onFocusOut = (event: FocusEvent) => {
      if (!view.dom.contains(event.relatedTarget as Node | null)) {
        setContextKey('editorFocus', false)
      }
    }
    view.dom.addEventListener('focusin', onFocusIn)
    view.dom.addEventListener('focusout', onFocusOut)

    const unregister = registerEditor(tabId, created.handle)

    return () => {
      positions.set(tabId, {
        head: view.state.selection.main.head,
        scrollTop: view.scrollDOM.scrollTop,
      })
      unregister()
      view.dom.removeEventListener('focusin', onFocusIn)
      view.dom.removeEventListener('focusout', onFocusOut)
      if (view.dom.contains(document.activeElement)) {
        setContextKey('editorFocus', false)
        setContextKey('editorTextFocus', false)
      }
      created.destroy()
      editor = undefined
    }
  })

  // A reload (external edit, conflict resolved by reloading, link rewrite
  // after a rename) replaces the buffer; `version` says when.
  $effect(() => {
    void doc.version
    const content = untrack(() => doc.content)
    editor?.setContent(content)
  })

  // Anything that re-reads the tree may change what links resolve to.
  $effect(() => {
    if (syncLinkCache(getTreeVersion())) editor?.refreshLinks()
  })
</script>

<div bind:this={host} class="note-editor h-full min-h-0"></div>
