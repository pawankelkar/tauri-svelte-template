/**
 * Builds one CodeMirror note editor. Everything CodeMirror lives in this
 * directory and loads with the note view's lazy chunk; the rest of the app
 * talks to a mounted editor through its `EditorHandle`.
 */
import { closeBrackets } from '@codemirror/autocomplete'
import { history } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxHighlighting } from '@codemirror/language'
import {
  highlightSelectionMatches,
  openSearchPanel,
  search,
} from '@codemirror/search'
import { EditorSelection, EditorState, Transaction } from '@codemirror/state'
import { drawSelection, dropCursor, EditorView } from '@codemirror/view'
import * as api from '$lib/vault/api'
import { logger } from '$lib/logger'
import type { EditorHandle, RevealTarget } from './editor-registry.svelte'
import { editorKeymap } from './keymap'
import { livePreview } from './live-preview'
import { BOLD, ITALIC, toggleWrap } from './markdown-commands'
import { FrontmatterSyntax } from './frontmatter-syntax'
import { editorTheme, markdownHighlightStyle } from './theme'
import { WikiLinkSyntax } from './wikilink-syntax'
import { refreshWikiLinks, wikiLinks } from './wikilinks'

export interface NoteEditorOptions {
  parent: HTMLElement
  content: string
  /** The note's current path (it changes on rename). */
  path: () => string
  onChange: (content: string) => void
  /** Caret line (0-based), for the outline's current heading. */
  onCursorLine?: (line: number) => void
  /** Whether the text area has focus. */
  onFocusChange?: (focused: boolean) => void
  ariaLabel?: string
}

export interface NoteEditor {
  view: EditorView
  handle: EditorHandle
  /** Replaces the whole text (a reload), keeping the caret where it can. */
  setContent(content: string): void
  /** Redraws links after the link cache was dropped. */
  refreshLinks(): void
  destroy(): void
}

function normalizeHeading(text: string): string {
  return text.trim().toLowerCase()
}

export function createNoteEditor(options: NoteEditorOptions): NoteEditor {
  // Set while `setContent` replaces the text, so that is not echoed back
  // as an edit.
  let applyingExternal = false

  const state = EditorState.create({
    doc: options.content,
    extensions: [
      history(),
      drawSelection(),
      dropCursor(),
      closeBrackets(),
      EditorView.lineWrapping,
      markdown({
        base: markdownLanguage,
        extensions: [FrontmatterSyntax, WikiLinkSyntax],
      }),
      syntaxHighlighting(markdownHighlightStyle),
      search({ top: true }),
      highlightSelectionMatches(),
      livePreview(),
      wikiLinks({ fromPath: options.path }),
      editorKeymap(),
      editorTheme,
      EditorView.contentAttributes.of({
        'aria-label': options.ariaLabel ?? '',
        spellcheck: 'true',
        autocorrect: 'on',
        autocapitalize: 'sentences',
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !applyingExternal) {
          options.onChange(update.state.doc.toString())
        }
        if (update.selectionSet || update.docChanged) {
          const head = update.state.selection.main.head
          options.onCursorLine?.(update.state.doc.lineAt(head).number - 1)
        }
        if (update.focusChanged) options.onFocusChange?.(update.view.hasFocus)
      }),
    ],
  })

  const view = new EditorView({ state, parent: options.parent })

  function revealLine(line: number): void {
    const doc = view.state.doc
    const number = Math.min(Math.max(line + 1, 1), doc.lines)
    const pos = doc.line(number).from
    view.dispatch({
      selection: EditorSelection.cursor(pos),
      effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 48 }),
    })
    view.focus()
  }

  async function revealHeading(heading: string): Promise<void> {
    try {
      const headings = await api.getOutline(view.state.doc.toString())
      const wanted = normalizeHeading(heading)
      const match = headings.find(
        (h) =>
          normalizeHeading(h.text) === wanted ||
          normalizeHeading(h.slug) === wanted,
      )
      if (match) revealLine(match.line)
    } catch (e) {
      logger.warn('Finding the heading failed', e)
    }
  }

  const handle: EditorHandle = {
    focus: () => view.focus(),
    reveal: (target: RevealTarget) => {
      if ('line' in target) revealLine(target.line)
      else void revealHeading(target.heading)
    },
    toggleBold: () => {
      toggleWrap(BOLD)(view)
    },
    toggleItalic: () => {
      toggleWrap(ITALIC)(view)
    },
    openFind: () => {
      openSearchPanel(view)
    },
    selectedText: () => {
      const { from, to } = view.state.selection.main
      return view.state.sliceDoc(from, to)
    },
  }

  return {
    view,
    handle,
    setContent(content: string) {
      if (content === view.state.doc.toString()) return
      const head = Math.min(view.state.selection.main.head, content.length)
      applyingExternal = true
      try {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: content },
          selection: EditorSelection.cursor(head),
          // A reload is not an undoable edit of the user's.
          annotations: Transaction.addToHistory.of(false),
        })
      } finally {
        applyingExternal = false
      }
    },
    refreshLinks() {
      view.dispatch({ effects: refreshWikiLinks.of(null) })
    },
    destroy() {
      view.destroy()
    },
  }
}
