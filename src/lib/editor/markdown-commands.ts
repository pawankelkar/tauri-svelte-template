/**
 * Small Markdown editing commands (bold, italic, task toggles), written
 * against `EditorState` so they can be tested without a DOM.
 */
import {
  EditorSelection,
  type EditorState,
  type TransactionSpec,
} from '@codemirror/state'
import type { Command } from '@codemirror/view'

export const BOLD = '**'
export const ITALIC = '*'

/** How many `ch` characters run back from `text`'s end (or on from its start). */
function run(text: string, ch: string, fromEnd: boolean): number {
  let count = 0
  const chars = fromEnd ? [...text].reverse() : [...text]
  for (const c of chars) {
    if (c !== ch) break
    count++
  }
  return count
}

/**
 * Whether a run of `count` marker characters on both sides of some text
 * reads as `marker` emphasis: `*x*` and `***x***` are italic, `**x**` and
 * `***x***` are bold.
 */
function runMatches(count: number, marker: string): boolean {
  if (marker.length === 1) return count === 1 || count === 3
  return count === 2 || count === 3
}

function isWrappedBy(before: string, after: string, marker: string): boolean {
  const ch = marker[0]!
  const left = run(before, ch, true)
  const right = run(after, ch, false)
  return left === right && runMatches(left, marker)
}

/**
 * Wraps each selection in `marker`, or unwraps it if it already is — with
 * the markers inside the selection or just around it. An empty selection
 * inserts a pair and leaves the caret between them.
 */
export function toggleWrapSpec(
  state: EditorState,
  marker: string,
): TransactionSpec {
  const size = marker.length
  return state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to)
    const before = state.sliceDoc(Math.max(0, range.from - 3), range.from)
    const after = state.sliceDoc(
      range.to,
      Math.min(state.doc.length, range.to + 3),
    )

    if (isWrappedBy(before, after, marker)) {
      return {
        changes: [
          { from: range.from - size, to: range.from },
          { from: range.to, to: range.to + size },
        ],
        range: EditorSelection.range(range.from - size, range.to - size),
      }
    }
    const lead = run(text, marker[0]!, false)
    const trail = run(text, marker[0]!, true)
    if (
      lead === trail &&
      text.length > lead + trail &&
      runMatches(lead, marker)
    ) {
      return {
        changes: [
          { from: range.from, to: range.from + size },
          { from: range.to - size, to: range.to },
        ],
        range: EditorSelection.range(range.from, range.to - size * 2),
      }
    }
    return {
      changes: [
        { from: range.from, insert: marker },
        { from: range.to, insert: marker },
      ],
      range: EditorSelection.range(range.from + size, range.to + size),
    }
  })
}

export function toggleWrap(marker: string): Command {
  return (view) => {
    if (view.state.readOnly) return false
    view.dispatch(
      view.state.update(toggleWrapSpec(view.state, marker), {
        scrollIntoView: true,
        userEvent: 'input.format',
      }),
    )
    return true
  }
}

const TASK_MARKER = /^\[( |x|X)\]$/

/**
 * Flips the task checkbox whose `[ ]` / `[x]` starts at `from`. Returns
 * `null` if there is no task marker there.
 */
export function toggleTaskSpec(
  state: EditorState,
  from: number,
): TransactionSpec | null {
  const marker = state.sliceDoc(from, from + 3)
  const match = TASK_MARKER.exec(marker)
  if (!match) return null
  const done = match[1] !== ' '
  return {
    changes: { from: from + 1, to: from + 2, insert: done ? ' ' : 'x' },
    userEvent: 'input.toggle',
  }
}
