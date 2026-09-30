/**
 * Live preview: Markdown that reads like the rendered page while staying
 * plain text.
 *
 * Styling (headings, emphasis, code, quotes, lists) is always on. Syntax
 * markers (`#`, `**`, `` ` ``, `>`, `-`) are hidden on every line except
 * the ones a selection touches, so the line being edited shows its source.
 * Task markers become checkboxes that toggle on click.
 *
 * Presentation only: the syntax tree comes from CodeMirror's Markdown
 * parser and is never used to index or interpret the note.
 */
import { syntaxTree } from '@codemirror/language'
import type { EditorState, Range } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view'
import type { SyntaxNodeRef } from '@lezer/common'
import { toggleTaskSpec } from './markdown-commands'

/**
 * Line numbers (1-based) a selection touches — the lines that show their
 * Markdown source. Empty while the editor is unfocused, so a note you are
 * only reading renders fully.
 */
export function activeLines(state: EditorState, focused: boolean): Set<number> {
  const lines = new Set<number>()
  if (!focused) return lines
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number
    const last = state.doc.lineAt(range.to).number
    for (let n = first; n <= last; n++) lines.add(n)
  }
  return lines
}

class BulletWidget extends WidgetType {
  override eq(): boolean {
    return true
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-md-bullet'
    span.textContent = '•'
    return span
  }
}

class TaskWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super()
  }
  override eq(other: TaskWidget): boolean {
    return other.checked === this.checked
  }
  toDOM(): HTMLElement {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.className = 'cm-md-task'
    box.checked = this.checked
    box.tabIndex = -1
    box.setAttribute('aria-hidden', 'true')
    return box
  }
  // Let the editor see clicks, so `toggleTaskOnClick` can flip the marker.
  override ignoreEvent(): boolean {
    return false
  }
}

const hidden = Decoration.replace({})
const bullet = Decoration.replace({ widget: new BulletWidget() })
const taskOpen = Decoration.replace({ widget: new TaskWidget(false) })
const taskDone = Decoration.replace({ widget: new TaskWidget(true) })

const markClass: Record<string, Decoration> = {
  StrongEmphasis: Decoration.mark({ class: 'cm-md-strong' }),
  Emphasis: Decoration.mark({ class: 'cm-md-em' }),
  Strikethrough: Decoration.mark({ class: 'cm-md-strike' }),
  InlineCode: Decoration.mark({ class: 'cm-md-code' }),
  Link: Decoration.mark({ class: 'cm-md-link' }),
  URL: Decoration.mark({ class: 'cm-md-url' }),
}

const fenceMark = Decoration.mark({ class: 'cm-md-fence' })
const listMark = Decoration.mark({ class: 'cm-md-listmark' })
const doneTaskText = Decoration.mark({ class: 'cm-md-task-done' })

const HEADING = /^ATXHeading([1-6])$/
const SETEXT = /^SetextHeading([12])$/

/** Markers that disappear off the active lines. */
const HIDDEN_MARKS = new Set(['EmphasisMark', 'StrikethroughMark'])

function lineDeco(className: string): Decoration {
  return Decoration.line({ class: className })
}

/**
 * The live-preview decorations for the visible part of the document.
 * Exported for tests, which run it against a bare `EditorState`.
 */
export function buildLivePreview(
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
  active: Set<number>,
): DecorationSet {
  const decos: Range<Decoration>[] = []
  const doc = state.doc
  const isActive = (pos: number) => active.has(doc.lineAt(pos).number)
  const eachLine = (
    from: number,
    to: number,
    fn: (lineFrom: number) => void,
  ) => {
    let pos = from
    while (pos <= to) {
      const line = doc.lineAt(pos)
      fn(line.from)
      pos = line.to + 1
    }
  }

  for (const { from, to } of ranges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node: SyntaxNodeRef) => {
        const name = node.name
        const heading = HEADING.exec(name) ?? SETEXT.exec(name)
        if (heading) {
          decos.push(
            lineDeco(`cm-md-heading cm-md-h${heading[1]}`).range(
              doc.lineAt(node.from).from,
            ),
          )
          return
        }
        const mark = markClass[name]
        if (mark && node.to > node.from) {
          decos.push(mark.range(node.from, node.to))
          return
        }
        switch (name) {
          case 'HeaderMark': {
            const parent = node.node.parent?.name ?? ''
            if (!HEADING.test(parent) || isActive(node.from)) return
            // The leading `#`s plus the space after them; a closing
            // `##` sequence (rare) is hidden too.
            const end =
              doc.sliceString(node.to, node.to + 1) === ' '
                ? node.to + 1
                : node.to
            decos.push(hidden.range(node.from, end))
            return
          }
          case 'CodeMark': {
            if (node.node.parent?.name !== 'InlineCode') {
              decos.push(fenceMark.range(node.from, node.to))
              return
            }
            if (!isActive(node.from))
              decos.push(hidden.range(node.from, node.to))
            return
          }
          case 'CodeInfo':
            decos.push(fenceMark.range(node.from, node.to))
            return
          case 'FencedCode':
          case 'CodeBlock':
            eachLine(node.from, node.to, (lineFrom) =>
              decos.push(lineDeco('cm-md-codeblock').range(lineFrom)),
            )
            return
          case 'Frontmatter':
            eachLine(node.from, node.to, (lineFrom) =>
              decos.push(lineDeco('cm-md-frontmatter').range(lineFrom)),
            )
            return false
          case 'Blockquote':
            eachLine(node.from, node.to, (lineFrom) =>
              decos.push(lineDeco('cm-md-quote').range(lineFrom)),
            )
            return
          case 'QuoteMark': {
            if (isActive(node.from)) return
            const end =
              doc.sliceString(node.to, node.to + 1) === ' '
                ? node.to + 1
                : node.to
            decos.push(hidden.range(node.from, end))
            return
          }
          case 'ListMark': {
            const list = node.node.parent?.parent?.name
            if (list !== 'BulletList' || isActive(node.from)) {
              decos.push(listMark.range(node.from, node.to))
              return
            }
            // A task item shows its checkbox instead of a bullet.
            const isTask = node.node.nextSibling?.name === 'Task'
            decos.push((isTask ? hidden : bullet).range(node.from, node.to))
            if (isTask) {
              const end =
                doc.sliceString(node.to, node.to + 1) === ' '
                  ? node.to + 1
                  : node.to
              if (end > node.to) decos.push(hidden.range(node.to, end))
            }
            return
          }
          case 'TaskMarker': {
            if (isActive(node.from)) return
            const done = doc.sliceString(node.from + 1, node.from + 2) !== ' '
            decos.push((done ? taskDone : taskOpen).range(node.from, node.to))
            return
          }
          case 'Task': {
            const text = doc.sliceString(node.from, node.from + 3)
            if (/^\[[xX]\]$/.test(text) && node.to > node.from + 3) {
              decos.push(doneTaskText.range(node.from + 3, node.to))
            }
            return
          }
          case 'HorizontalRule':
            decos.push(lineDeco('cm-md-hr').range(doc.lineAt(node.from).from))
            return
          default:
            if (HIDDEN_MARKS.has(name) && !isActive(node.from)) {
              decos.push(hidden.range(node.from, node.to))
            }
        }
      },
    })
  }
  return Decoration.set(decos, true)
}

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = this.build(view)
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        update.focusChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = this.build(update.view)
      }
    }

    build(view: EditorView): DecorationSet {
      return buildLivePreview(
        view.state,
        view.visibleRanges,
        activeLines(view.state, view.hasFocus),
      )
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

/** Clicking a rendered checkbox flips its `[ ]` / `[x]`. */
const toggleTaskOnClick = EditorView.domEventHandlers({
  mousedown(event, view) {
    const target = event.target
    if (
      !(target instanceof HTMLInputElement) ||
      !target.classList.contains('cm-md-task')
    ) {
      return false
    }
    const spec = toggleTaskSpec(view.state, view.posAtDOM(target))
    if (!spec) return false
    view.dispatch(spec)
    return true
  },
})

export function livePreview() {
  return [livePreviewPlugin, toggleTaskOnClick]
}
