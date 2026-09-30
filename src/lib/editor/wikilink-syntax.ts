/**
 * `[[target#heading|alias]]` as a Markdown inline node, for decoration only.
 *
 * This is presentation: it tells the editor where to draw a link. What a
 * link points at is always asked of Rust (`resolveLink`), and indexing,
 * backlinks and rename rewrites never look at this tree.
 *
 * Produces:
 *
 *     WikiLink
 *       WikiLinkMark        "[["
 *       WikiLinkTarget      "target#heading"
 *       WikiLinkMark        "|"         (only with an alias)
 *       WikiLinkAlias       "alias"
 *       WikiLinkMark        "]]"
 *
 * An embed (`![[…]]`) is left to Markdown: the `!` stays plain text and the
 * rest parses as a link, which is what P1 shows for embeds.
 */
import type { Element, InlineContext, MarkdownConfig } from '@lezer/markdown'
import { tags } from '@lezer/highlight'

const OPEN_BRACKET = 91 // [
const CLOSE_BRACKET = 93 // ]
const PIPE = 124 // |
const NEWLINE = 10

export const WIKILINK = 'WikiLink'
export const WIKILINK_MARK = 'WikiLinkMark'
const WIKILINK_TARGET = 'WikiLinkTarget'
export const WIKILINK_ALIAS = 'WikiLinkAlias'

function parseWikiLink(cx: InlineContext, next: number, start: number): number {
  if (next !== OPEN_BRACKET || cx.char(start + 1) !== OPEN_BRACKET) return -1
  const from = start + 2
  let pipe = -1
  for (let pos = from; pos < cx.end; pos++) {
    const ch = cx.char(pos)
    if (ch === NEWLINE || ch === OPEN_BRACKET) return -1
    if (ch === PIPE && pipe === -1) pipe = pos
    if (ch === CLOSE_BRACKET) {
      if (cx.char(pos + 1) !== CLOSE_BRACKET) return -1
      const targetEnd = pipe === -1 ? pos : pipe
      if (cx.slice(from, targetEnd).trim() === '') return -1
      const children: Element[] = [
        cx.elt(WIKILINK_MARK, start, from),
        cx.elt(WIKILINK_TARGET, from, targetEnd),
      ]
      if (pipe !== -1) {
        children.push(cx.elt(WIKILINK_MARK, pipe, pipe + 1))
        if (pos > pipe + 1) children.push(cx.elt(WIKILINK_ALIAS, pipe + 1, pos))
      }
      children.push(cx.elt(WIKILINK_MARK, pos, pos + 2))
      return cx.addElement(cx.elt(WIKILINK, start, pos + 2, children))
    }
  }
  return -1
}

export const WikiLinkSyntax: MarkdownConfig = {
  defineNodes: [
    { name: WIKILINK, style: tags.link },
    { name: WIKILINK_MARK, style: tags.processingInstruction },
    { name: WIKILINK_TARGET },
    { name: WIKILINK_ALIAS },
  ],
  parseInline: [{ name: WIKILINK, parse: parseWikiLink, before: 'Link' }],
}

/** The pieces of one wikilink, from its source text. */
export interface WikiLinkParts {
  /** What goes to `resolveLink`: `target#heading`, without the alias. */
  target: string
  /** The note part of the target (before any `#`). */
  note: string
  heading: string | null
  alias: string | null
}

/** Splits the inside of `[[…]]` (without the brackets). */
export function splitWikiLink(inner: string): WikiLinkParts {
  const pipe = inner.indexOf('|')
  const target = (pipe === -1 ? inner : inner.slice(0, pipe)).trim()
  const alias = pipe === -1 ? null : inner.slice(pipe + 1).trim() || null
  const hash = target.indexOf('#')
  const note = (hash === -1 ? target : target.slice(0, hash)).trim()
  const heading = hash === -1 ? null : target.slice(hash + 1).trim() || null
  return { target, note, heading, alias }
}
