import { describe, it, expect } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import {
  BOLD,
  ITALIC,
  toggleTaskSpec,
  toggleWrapSpec,
} from './markdown-commands'

function state(doc: string, from: number, to = from) {
  return EditorState.create({
    doc,
    selection: EditorSelection.single(from, to),
  })
}

function apply(s: EditorState, marker: string) {
  const next = s.update(toggleWrapSpec(s, marker)).state
  const { from, to } = next.selection.main
  return { doc: next.doc.toString(), from, to }
}

describe('toggleWrapSpec', () => {
  it('wraps a selection and keeps it selected', () => {
    expect(apply(state('say hi now', 4, 6), BOLD)).toEqual({
      doc: 'say **hi** now',
      from: 6,
      to: 8,
    })
  })

  it('inserts a pair around the caret for an empty selection', () => {
    expect(apply(state('ab', 1), ITALIC)).toEqual({
      doc: 'a**b',
      from: 2,
      to: 2,
    })
  })

  it('unwraps markers just outside the selection', () => {
    expect(apply(state('say **hi** now', 6, 8), BOLD).doc).toBe('say hi now')
  })

  it('unwraps markers inside the selection', () => {
    const result = apply(state('say *hi* now', 4, 8), ITALIC)
    expect(result).toEqual({ doc: 'say hi now', from: 4, to: 6 })
  })

  it('does not mistake bold for italic', () => {
    expect(apply(state('**hi**', 2, 4), ITALIC).doc).toBe('***hi***')
    expect(apply(state('***hi***', 3, 5), ITALIC).doc).toBe('**hi**')
    expect(apply(state('***hi***', 3, 5), BOLD).doc).toBe('*hi*')
  })
})

describe('toggleTaskSpec', () => {
  it('flips a checkbox at the given position', () => {
    const open = EditorState.create({ doc: '- [ ] task' })
    const done = open.update(toggleTaskSpec(open, 2)!).state
    expect(done.doc.toString()).toBe('- [x] task')
    const again = done.update(toggleTaskSpec(done, 2)!).state
    expect(again.doc.toString()).toBe('- [ ] task')
  })

  it('returns null when no marker is there', () => {
    const s = EditorState.create({ doc: '- task' })
    expect(toggleTaskSpec(s, 2)).toBeNull()
  })
})
