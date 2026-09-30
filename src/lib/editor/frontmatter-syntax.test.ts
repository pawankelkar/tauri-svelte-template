import { describe, it, expect } from 'vitest'
import { GFM, parser } from '@lezer/markdown'
import { FRONTMATTER, FrontmatterSyntax } from './frontmatter-syntax'

const md = parser.configure([GFM, FrontmatterSyntax])

/** Top-level block nodes with their text. */
function blocks(text: string): string[] {
  const out: string[] = []
  const cursor = md.parse(text).cursor()
  if (!cursor.firstChild()) return out
  do out.push(`${cursor.name}:${text.slice(cursor.from, cursor.to)}`)
  while (cursor.nextSibling())
  return out
}

describe('FrontmatterSyntax', () => {
  it('reads a leading --- block as frontmatter, not a heading', () => {
    const text = '---\ntitle: A\ntags: [x]\n---\n\n# Body'
    expect(blocks(text)).toEqual([
      `${FRONTMATTER}:---\ntitle: A\ntags: [x]\n---`,
      'ATXHeading1:# Body',
    ])
  })

  it('accepts ... as the closing line', () => {
    expect(blocks('---\na: 1\n...\ntext')).toEqual([
      `${FRONTMATTER}:---\na: 1\n...`,
      'Paragraph:text',
    ])
  })

  it('only applies at the very top of the note', () => {
    const out = blocks('intro\n\n---\na: 1\n---')
    expect(out.some((b) => b.startsWith(FRONTMATTER))).toBe(false)
  })

  it('runs to the end while unterminated', () => {
    expect(blocks('---\na: 1')).toEqual([`${FRONTMATTER}:---\na: 1`])
  })
})
