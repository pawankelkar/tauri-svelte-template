/**
 * YAML frontmatter (`---` … `---` at the very top) as a Markdown block, for
 * decoration only. Without it, Markdown reads the closing `---` as a setext
 * underline and draws the metadata as a heading.
 *
 * This is presentation: what the frontmatter means (title, tags) is parsed
 * in Rust. The block's contents are not parsed as Markdown.
 *
 * Produces:
 *
 *     Frontmatter
 *       FrontmatterMark   "---"
 *       FrontmatterMark   "---" or "..."   (absent while unterminated)
 */
import type { BlockContext, Line, MarkdownConfig } from '@lezer/markdown'
import { tags } from '@lezer/highlight'

export const FRONTMATTER = 'Frontmatter'
const FRONTMATTER_MARK = 'FrontmatterMark'

const OPEN = /^---\s*$/
const CLOSE = /^(---|\.\.\.)\s*$/

function parseFrontmatter(cx: BlockContext, line: Line): boolean {
  if (cx.lineStart !== 0 || !OPEN.test(line.text)) return false
  const start = cx.lineStart
  const marks = [cx.elt(FRONTMATTER_MARK, start, start + line.text.length)]
  let end = start + line.text.length
  while (cx.nextLine()) {
    end = cx.lineStart + line.text.length
    if (CLOSE.test(line.text)) {
      marks.push(cx.elt(FRONTMATTER_MARK, cx.lineStart, end))
      cx.nextLine()
      break
    }
  }
  // An unterminated block runs to the end of the note, as it would once
  // the closing line is typed.
  cx.addElement(cx.elt(FRONTMATTER, start, end, marks))
  return true
}

export const FrontmatterSyntax: MarkdownConfig = {
  defineNodes: [
    { name: FRONTMATTER, block: true, style: tags.meta },
    { name: FRONTMATTER_MARK, style: tags.processingInstruction },
  ],
  parseBlock: [
    { name: FRONTMATTER, parse: parseFrontmatter, before: 'HorizontalRule' },
  ],
}
