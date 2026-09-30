/**
 * `[[wikilinks]]` in the editor: styling, following and completion.
 *
 * - Links render as links; ones whose note does not exist (per Rust's
 *   `resolveLink`, cached in `link-cache.ts`) are styled as unresolved.
 *   Off the active lines the brackets are hidden, and so is the target
 *   when the link has an alias.
 * - **Mod+click** (⌘ on macOS, Ctrl elsewhere) follows a link; a plain
 *   click places the caret, so links stay editable. Following an
 *   unresolved link creates the note. Mod+Shift+click opens a kept tab.
 * - Typing `[[` offers notes from `quickOpen`; after `[[Note#` it offers
 *   that note's headings (`getOutline`).
 */
import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete'
import { syntaxTree } from '@codemirror/language'
import { type EditorState, type Range, StateEffect } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import * as api from '$lib/vault/api'
import { noteStem } from '$lib/vault/paths'
import { logger } from '$lib/logger'
import { activeLines } from './live-preview'
import { cachedLink, followWikiLink, resolveLinkCached } from './link-cache'
import {
  WIKILINK,
  WIKILINK_ALIAS,
  WIKILINK_MARK,
  splitWikiLink,
} from './wikilink-syntax'

/** Dispatched when cached resolutions arrive (or the cache was dropped). */
export const refreshWikiLinks = StateEffect.define<null>()

const resolvedLink = Decoration.mark({ class: 'cm-wikilink' })
const unresolvedLink = Decoration.mark({
  class: 'cm-wikilink cm-wikilink-unresolved',
})
const hidden = Decoration.replace({})

export interface WikiLinkOptions {
  /** The note being edited: links resolve relative to it. */
  fromPath: () => string
}

/** The text between the brackets of a `WikiLink` node. */
function innerText(state: EditorState, node: SyntaxNode): string {
  return state.sliceDoc(node.from + 2, node.to - 2)
}

/**
 * The wikilink decorations for the given ranges. Targets with no cached
 * answer are reported through `missing` (and drawn as resolved until the
 * answer arrives, so existing links do not flash). Exported for tests.
 */
export function buildWikiLinkDecorations(
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
  active: Set<number>,
  fromPath: string,
  missing: Set<string>,
): DecorationSet {
  const decos: Range<Decoration>[] = []
  for (const { from, to } of ranges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (ref) => {
        if (ref.name !== WIKILINK) return
        const node = ref.node
        const { target } = splitWikiLink(innerText(state, node))
        const link = cachedLink(fromPath, target)
        if (link === undefined) missing.add(target)
        const exists = link?.exists ?? true
        decos.push(
          (exists ? resolvedLink : unresolvedLink).range(node.from, node.to),
        )

        if (active.has(state.doc.lineAt(node.from).number)) return false
        const alias = node.getChild(WIKILINK_ALIAS)
        const marks = node.getChildren(WIKILINK_MARK)
        const open = marks[0]
        const close = marks[marks.length - 1]
        if (alias && open) {
          // `[[target|` disappears, leaving the alias.
          decos.push(hidden.range(open.from, alias.from))
        } else if (open) {
          decos.push(hidden.range(open.from, open.to))
        }
        if (close && close !== open)
          decos.push(hidden.range(close.from, close.to))
        return false
      },
    })
  }
  return Decoration.set(decos, true)
}

function wikiLinkPlugin(options: WikiLinkOptions) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      destroyed = false

      constructor(readonly view: EditorView) {
        this.decorations = this.build()
      }

      destroy() {
        this.destroyed = true
      }

      update(update: ViewUpdate) {
        const refreshed = update.transactions.some((tr) =>
          tr.effects.some((e) => e.is(refreshWikiLinks)),
        )
        if (
          refreshed ||
          update.docChanged ||
          update.viewportChanged ||
          update.selectionSet ||
          update.focusChanged ||
          syntaxTree(update.startState) !== syntaxTree(update.state)
        ) {
          this.decorations = this.build()
        }
      }

      build(): DecorationSet {
        const missing = new Set<string>()
        const fromPath = options.fromPath()
        const decorations = buildWikiLinkDecorations(
          this.view.state,
          this.view.visibleRanges,
          activeLines(this.view.state, this.view.hasFocus),
          fromPath,
          missing,
        )
        if (missing.size > 0) this.resolve(fromPath, [...missing])
        return decorations
      }

      resolve(fromPath: string, targets: string[]): void {
        void Promise.all(
          targets.map((target) => resolveLinkCached(fromPath, target)),
        ).then((links) => {
          // Only redraw if something is now known that was not before;
          // failures stay unknown and are not retried in a loop.
          if (this.destroyed || links.every((l) => l === null)) return
          this.view.dispatch({ effects: refreshWikiLinks.of(null) })
        })
      }
    },
    { decorations: (plugin) => plugin.decorations },
  )
}

/** The `WikiLink` node at `pos`, if any. */
export function wikiLinkAt(state: EditorState, pos: number): SyntaxNode | null {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1)
  while (node) {
    if (node.name === WIKILINK) return node
    node = node.parent
  }
  // `resolveInner` leans right; a click on the last `]` sits at the end.
  node = syntaxTree(state).resolveInner(pos, -1)
  while (node) {
    if (node.name === WIKILINK) return node
    node = node.parent
  }
  return null
}

function followOnModClick(options: WikiLinkOptions) {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (event.button !== 0 || !(event.metaKey || event.ctrlKey)) return false
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
      if (pos === null) return false
      const node = wikiLinkAt(view.state, pos)
      if (!node) return false
      void followWikiLink(options.fromPath(), innerText(view.state, node), {
        newTab: event.shiftKey,
      })
      return true
    },
  })
}

// --- Completion -----------------------------------------------------------------

const NOTE_LIMIT = 20

/** Inserts `text` and the closing `]]` (reusing one already there). */
function applyLink(text: string) {
  return (
    view: EditorView,
    _completion: Completion,
    from: number,
    to: number,
  ) => {
    const closing = view.state.sliceDoc(to, to + 2) === ']]' ? to + 2 : to
    const insert = `${text}]]`
    view.dispatch({
      changes: { from, to: closing, insert },
      selection: { anchor: from + insert.length },
      userEvent: 'input.complete',
    })
  }
}

async function noteOptions(query: string): Promise<Completion[]> {
  const items = await api.quickOpen(query, NOTE_LIMIT)
  return items.map((item, index) => {
    const stem = noteStem(item.path)
    return {
      label: stem,
      detail: item.title !== stem ? item.title : item.path,
      // Rust ranks; keep its order.
      boost: NOTE_LIMIT - index,
      apply: applyLink(stem),
    }
  })
}

async function headingOptions(
  state: EditorState,
  fromPath: string,
  note: string,
): Promise<Completion[]> {
  let content: string
  if (note === '') {
    content = state.doc.toString()
  } else {
    const link = await resolveLinkCached(fromPath, note)
    if (!link?.exists || !link.path) return []
    content = (await api.readNote(link.path)).content
  }
  const headings = await api.getOutline(content)
  return headings.map((h) => ({
    label: h.text,
    detail: '#'.repeat(h.level),
    apply: applyLink(h.text),
  }))
}

/** The `[[…` completion source. Exported for tests. */
export function wikiLinkCompletionSource(options: WikiLinkOptions) {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const match = ctx.matchBefore(/\[\[[^[\]|\n]*$/)
    if (!match) return null
    const inner = match.text.slice(2)
    const hash = inner.indexOf('#')
    try {
      if (hash === -1) {
        const opts = await noteOptions(inner)
        if (ctx.aborted) return null
        return { from: match.from + 2, options: opts, filter: false }
      }
      const opts = await headingOptions(
        ctx.state,
        options.fromPath(),
        inner.slice(0, hash).trim(),
      )
      if (ctx.aborted) return null
      return { from: match.from + 2 + hash + 1, options: opts }
    } catch (e) {
      logger.warn('Link completion failed', e)
      return null
    }
  }
}

export function wikiLinks(options: WikiLinkOptions) {
  return [
    wikiLinkPlugin(options),
    followOnModClick(options),
    autocompletion({
      override: [wikiLinkCompletionSource(options)],
      icons: false,
    }),
  ]
}
