import { describe, it, expect } from 'vitest'
import { parser } from '@lezer/markdown'
import {
  splitWikiLink,
  WikiLinkSyntax,
  WIKILINK,
  WIKILINK_ALIAS,
  WIKILINK_MARK,
} from './wikilink-syntax'

const md = parser.configure([WikiLinkSyntax])

function nodes(text: string): string[] {
  const out: string[] = []
  md.parse(text).iterate({
    enter: (node) => {
      if (node.name.startsWith('WikiLink')) {
        out.push(`${node.name}:${text.slice(node.from, node.to)}`)
      }
    },
  })
  return out
}

describe('WikiLinkSyntax', () => {
  it('parses target and alias', () => {
    expect(nodes('see [[Note#Head|shown]] here')).toEqual([
      `${WIKILINK}:[[Note#Head|shown]]`,
      `${WIKILINK_MARK}:[[`,
      'WikiLinkTarget:Note#Head',
      `${WIKILINK_MARK}:|`,
      `${WIKILINK_ALIAS}:shown`,
      `${WIKILINK_MARK}:]]`,
    ])
  })

  it.each(['[[]]', '[[  ]]', '[[a\nb]]', '[[a]', '[[a[b]]'])(
    'ignores %j',
    (text) => {
      expect(nodes(text).filter((n) => n.startsWith(`${WIKILINK}:`))).toEqual(
        [],
      )
    },
  )
})

describe('splitWikiLink', () => {
  it('splits note, heading and alias', () => {
    expect(splitWikiLink(' Note # Head | Shown ')).toEqual({
      target: 'Note # Head',
      note: 'Note',
      heading: 'Head',
      alias: 'Shown',
    })
  })

  it('handles bare and heading-only links', () => {
    expect(splitWikiLink('Note')).toEqual({
      target: 'Note',
      note: 'Note',
      heading: null,
      alias: null,
    })
    expect(splitWikiLink('#Only')).toMatchObject({ note: '', heading: 'Only' })
    expect(splitWikiLink('Note|')).toMatchObject({ alias: null })
  })
})
