import { describe, it, expect } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import { activeLines } from './live-preview'

const DOC = 'one\ntwo\nthree\nfour'

function at(...ranges: [number, number][]) {
  return EditorState.create({
    doc: DOC,
    selection: EditorSelection.create(
      ranges.map(([a, b]) => EditorSelection.range(a, b)),
    ),
    extensions: EditorState.allowMultipleSelections.of(true),
  })
}

describe('activeLines', () => {
  it('is empty while unfocused so the note renders fully', () => {
    expect([...activeLines(at([0, 0]), false)]).toEqual([])
  })

  it('covers every line a selection touches', () => {
    // "two" starts at 4, "three" ends at 13.
    expect([...activeLines(at([5, 10]), true)].sort()).toEqual([2, 3])
    expect([...activeLines(at([0, 0], [15, 15]), true)].sort()).toEqual([1, 4])
  })
})
