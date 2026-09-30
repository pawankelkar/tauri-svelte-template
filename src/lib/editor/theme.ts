/**
 * The note editor's look, built only from the app's CSS variables so every
 * theme (built-in, imported VS Code, light or dark) applies unchanged.
 */
import { HighlightStyle } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'

const MONO =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'

export const editorTheme = EditorView.theme({
  '&': {
    color: 'var(--foreground)',
    backgroundColor: 'transparent',
    fontSize: '1rem',
    height: '100%',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--sd-font-ui, var(--font-sans))',
    lineHeight: '1.65',
    overflow: 'auto',
  },
  '.cm-content': {
    // The app resets `cursor: default` everywhere; text wants an I-beam.
    cursor: 'text',
    caretColor: 'var(--primary)',
    maxWidth: '46rem',
    margin: '0 auto',
    padding: '1.5rem 2rem 40vh',
  },
  '.cm-line': { padding: '0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--foreground)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection':
    {
      backgroundColor:
        'color-mix(in oklab, var(--primary) 22%, transparent) !important',
    },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-gutters': { display: 'none' },

  // Live preview
  '.cm-md-heading': { fontWeight: '650', lineHeight: '1.3' },
  '.cm-md-h1': { fontSize: '1.9em', paddingTop: '0.6em !important' },
  '.cm-md-h2': { fontSize: '1.5em', paddingTop: '0.5em !important' },
  '.cm-md-h3': { fontSize: '1.25em', paddingTop: '0.4em !important' },
  '.cm-md-h4': { fontSize: '1.1em' },
  '.cm-md-h5, .cm-md-h6': {
    fontSize: '1em',
    color: 'var(--muted-foreground)',
  },
  '.cm-md-strong': { fontWeight: '700' },
  '.cm-md-em': { fontStyle: 'italic' },
  '.cm-md-strike': { textDecoration: 'line-through' },
  '.cm-md-code': {
    fontFamily: MONO,
    fontSize: '0.88em',
    backgroundColor: 'var(--muted)',
    borderRadius: '4px',
    padding: '0.1em 0.3em',
  },
  '.cm-md-codeblock': {
    fontFamily: MONO,
    fontSize: '0.88em',
    backgroundColor: 'var(--muted)',
  },
  '.cm-md-fence': { color: 'var(--muted-foreground)' },
  '.cm-md-quote': {
    borderLeft: '3px solid var(--border)',
    paddingLeft: '0.9em !important',
    color: 'var(--muted-foreground)',
  },
  '.cm-md-bullet': {
    display: 'inline-block',
    width: '0.9em',
    color: 'var(--muted-foreground)',
  },
  '.cm-md-listmark': { color: 'var(--muted-foreground)' },
  '.cm-md-task': {
    cursor: 'pointer',
    margin: '0 0.35em 0 0',
    verticalAlign: 'middle',
    accentColor: 'var(--primary)',
  },
  '.cm-md-task-done': {
    color: 'var(--muted-foreground)',
    textDecoration: 'line-through',
  },
  '.cm-md-frontmatter': {
    fontFamily: MONO,
    fontSize: '0.85em',
    color: 'var(--muted-foreground)',
  },
  '.cm-md-hr': { color: 'var(--muted-foreground)' },
  '.cm-md-link': { color: 'var(--primary)' },
  '.cm-md-url': { color: 'var(--muted-foreground)' },

  // Wikilinks
  '.cm-wikilink': {
    color: 'var(--primary)',
    textDecoration: 'underline',
    textDecorationColor: 'color-mix(in oklab, var(--primary) 40%, transparent)',
    textUnderlineOffset: '2px',
  },
  '.cm-wikilink-unresolved': {
    color: 'var(--muted-foreground)',
    textDecorationStyle: 'dashed',
    textDecorationColor: 'var(--muted-foreground)',
  },

  // Search panel and completion
  '.cm-panels': {
    backgroundColor: 'var(--popover)',
    color: 'var(--popover-foreground)',
  },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-panel.cm-search': {
    fontFamily: 'var(--sd-font-ui, var(--font-sans))',
    fontSize: '0.85rem',
    padding: '0.4rem 0.6rem',
  },
  '.cm-panel.cm-search input, .cm-panel.cm-search button': {
    fontFamily: 'inherit',
    fontSize: 'inherit',
    color: 'inherit',
    borderRadius: '4px',
  },
  '.cm-textfield': {
    backgroundColor: 'var(--background)',
    border: '1px solid var(--border)',
  },
  '.cm-button': {
    backgroundImage: 'none',
    backgroundColor: 'var(--muted)',
    border: '1px solid var(--border)',
  },
  '.cm-searchMatch': {
    backgroundColor: 'color-mix(in oklab, var(--primary) 18%, transparent)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'color-mix(in oklab, var(--primary) 38%, transparent)',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--popover)',
    color: 'var(--popover-foreground)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    overflow: 'hidden',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': {
    fontFamily: 'var(--sd-font-ui, var(--font-sans))',
    maxHeight: '16rem',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { padding: '0.2rem 0.6rem' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': {
    backgroundColor: 'var(--accent)',
    color: 'var(--accent-foreground)',
  },
  '.cm-completionDetail': {
    color: 'var(--muted-foreground)',
    fontStyle: 'normal',
    marginLeft: '0.75em',
  },
  '.cm-completionMatchedText': { textDecoration: 'none', fontWeight: '600' },
})

/**
 * Token colours. Sizes and weights come from the live-preview line classes
 * above; this only tints the syntax that stays visible (marks, URLs, code).
 * CodeMirror's default style underlines headings, which reads as a link.
 */
export const markdownHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, fontWeight: '650' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: 'var(--primary)' },
  { tag: tags.url, color: 'var(--muted-foreground)' },
  { tag: tags.monospace, fontFamily: MONO },
  {
    tag: [tags.processingInstruction, tags.contentSeparator, tags.meta],
    color: 'var(--muted-foreground)',
  },
  { tag: tags.quote, color: 'var(--muted-foreground)' },
])
