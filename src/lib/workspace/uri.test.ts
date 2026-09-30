import { describe, it, expect } from 'vitest'
import {
  parseUri,
  formatUri,
  noteTitleFromPath,
  type WorkspaceTarget,
} from './uri'
import { DEEP_LINK_SCHEME } from '$lib/deep-link'

describe('parseUri — note', () => {
  it('parses a single-segment path', () => {
    expect(parseUri('ostralith://note/Inbox.md')).toEqual({
      kind: 'note',
      path: 'Inbox.md',
    })
  })

  it('parses nested, percent-encoded segments', () => {
    expect(
      parseUri('ostralith://note/Projects/Q3%20Plan/Caf%C3%A9%20notes.md'),
    ).toEqual({
      kind: 'note',
      path: 'Projects/Q3 Plan/Café notes.md',
    })
  })

  it('parses a heading fragment', () => {
    expect(parseUri('ostralith://note/a/b.md#Next%20steps')).toEqual({
      kind: 'note',
      path: 'a/b.md',
      heading: 'Next steps',
    })
  })

  it('treats an empty or blank fragment as no heading', () => {
    expect(parseUri('ostralith://note/a.md#')).toEqual({
      kind: 'note',
      path: 'a.md',
    })
    expect(parseUri('ostralith://note/a.md#%20%20')).toEqual({
      kind: 'note',
      path: 'a.md',
    })
  })

  it('keeps an encoded # inside a file name as part of the path', () => {
    expect(parseUri('ostralith://note/C%23%20tips.md')).toEqual({
      kind: 'note',
      path: 'C# tips.md',
    })
  })

  it('matches scheme and kind case-insensitively, but not the path', () => {
    expect(parseUri('OSTRALITH://Note/ReadMe.md')).toEqual({
      kind: 'note',
      path: 'ReadMe.md',
    })
  })

  it('tolerates surrounding whitespace', () => {
    expect(parseUri('  ostralith://note/a.md\n')).toEqual({
      kind: 'note',
      path: 'a.md',
    })
  })

  it.each([
    ['missing path', 'ostralith://note'],
    ['empty path', 'ostralith://note/'],
    ['absolute path', 'ostralith://note//etc/passwd'],
    ['trailing slash', 'ostralith://note/a/'],
    ['double slash', 'ostralith://note/a//b.md'],
    ['parent segment', 'ostralith://note/../secret.md'],
    ['nested parent segment', 'ostralith://note/a/../../b.md'],
    ['encoded parent segment', 'ostralith://note/a/%2E%2E/b.md'],
    ['dot segment', 'ostralith://note/./a.md'],
    ['encoded slash', 'ostralith://note/a%2F..%2Fb.md'],
    ['raw backslash', 'ostralith://note/a\\b.md'],
    ['encoded backslash', 'ostralith://note/a%5Cb.md'],
    ['NUL byte', 'ostralith://note/a%00.md'],
    ['control character', 'ostralith://note/a%0A.md'],
    ['Windows drive', 'ostralith://note/C:/Users/x.md'],
    ['malformed escape', 'ostralith://note/a%E0%A4%A.md'],
    ['NUL in heading', 'ostralith://note/a.md#x%00'],
    ['malformed heading escape', 'ostralith://note/a.md#%E0'],
  ])('rejects %s', (_label, uri) => {
    expect(parseUri(uri)).toBeNull()
  })
})

describe('parseUri — view', () => {
  it('parses a view id', () => {
    expect(parseUri('ostralith://view/settings')).toEqual({
      kind: 'view',
      id: 'settings',
    })
    expect(parseUri('ostralith://view/settings.shortcuts')).toEqual({
      kind: 'view',
      id: 'settings.shortcuts',
    })
  })

  it.each([
    ['missing id', 'ostralith://view'],
    ['empty id', 'ostralith://view/'],
    ['nested id', 'ostralith://view/a/b'],
    ['spaces', 'ostralith://view/a%20b'],
    ['leading dot', 'ostralith://view/.hidden'],
    ['too long', `ostralith://view/${'a'.repeat(60)}`],
  ])('rejects %s', (_label, uri) => {
    expect(parseUri(uri)).toBeNull()
  })
})

describe('parseUri — search', () => {
  it('parses the q parameter', () => {
    expect(parseUri('ostralith://search?q=hello%20world')).toEqual({
      kind: 'search',
      query: 'hello world',
    })
  })

  it('decodes + as a space and tolerates a trailing slash', () => {
    expect(parseUri('ostralith://search/?q=a+b')).toEqual({
      kind: 'search',
      query: 'a b',
    })
  })

  it('ignores other parameters', () => {
    expect(parseUri('ostralith://search?x=1&q=tag%3Awork')).toEqual({
      kind: 'search',
      query: 'tag:work',
    })
  })

  it.each([
    ['missing q', 'ostralith://search'],
    ['blank q', 'ostralith://search?q=%20'],
    ['a path', 'ostralith://search/deep?q=x'],
    ['NUL in q', 'ostralith://search?q=a%00'],
  ])('rejects %s', (_label, uri) => {
    expect(parseUri(uri)).toBeNull()
  })
})

describe('parseUri — everything else', () => {
  it.each([
    ['empty string', ''],
    ['another scheme', 'https://note/a.md'],
    ['no authority slashes', 'ostralith:note/a.md'],
    ['unknown kind', 'ostralith://pdf/a.pdf'],
    ['scheme only', 'ostralith://'],
  ])('rejects %s', (_label, uri) => {
    expect(parseUri(uri)).toBeNull()
  })

  it('rejects URIs too long to persist as a tab', () => {
    expect(parseUri(`ostralith://note/${'a'.repeat(5000)}.md`)).toBeNull()
  })

  it('rejects non-string input', () => {
    expect(parseUri(42 as unknown as string)).toBeNull()
  })

  it('uses the app deep-link scheme', () => {
    expect(DEEP_LINK_SCHEME).toBe('ostralith')
  })
})

describe('formatUri', () => {
  it('encodes each path segment but keeps the separators', () => {
    expect(formatUri({ kind: 'note', path: 'Q3 Plan/C# tips?.md' })).toBe(
      'ostralith://note/Q3%20Plan/C%23%20tips%3F.md',
    )
  })

  it('appends an encoded heading', () => {
    expect(
      formatUri({ kind: 'note', path: 'a.md', heading: 'Next steps' }),
    ).toBe('ostralith://note/a.md#Next%20steps')
  })

  it('formats views and searches', () => {
    expect(formatUri({ kind: 'view', id: 'settings' })).toBe(
      'ostralith://view/settings',
    )
    expect(formatUri({ kind: 'search', query: 'a&b=c' })).toBe(
      'ostralith://search?q=a%26b%3Dc',
    )
  })

  it.each<WorkspaceTarget>([
    { kind: 'note', path: 'a.md' },
    { kind: 'note', path: 'Deep/Nested Folder/Ünïcödé 📝.md' },
    { kind: 'note', path: '100% done/#1.md', heading: 'A # heading?' },
    { kind: 'view', id: 'settings.about' },
    { kind: 'search', query: 'tag:work "exact phrase" +more' },
  ])('round-trips %j', (target) => {
    expect(parseUri(formatUri(target))).toEqual(target)
  })

  it('canonicalises equivalent spellings to one URI', () => {
    const a = parseUri('OSTRALITH://NOTE/My%20Note.md')!
    const b = parseUri('ostralith://note/My%20Note.md')!
    expect(formatUri(a)).toBe(formatUri(b))
  })
})

describe('noteTitleFromPath', () => {
  it('uses the file name without a .md extension', () => {
    expect(noteTitleFromPath('Projects/Q3 Plan.md')).toBe('Q3 Plan')
    expect(noteTitleFromPath('Inbox.MD')).toBe('Inbox')
  })

  it('keeps other extensions', () => {
    expect(noteTitleFromPath('files/report.pdf')).toBe('report.pdf')
  })

  it('does not return an empty title for a bare extension', () => {
    expect(noteTitleFromPath('.md')).toBe('.md')
  })
})
