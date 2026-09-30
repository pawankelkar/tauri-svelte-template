/**
 * Dev-only in-memory vault for the browser preview.
 *
 * Implements every P1 vault / search / db / backup command closely enough
 * that the whole P1 UI (onboarding, file tree, editor with conflict
 * handling, backlinks, outline, quick open, search, backups) can be built
 * and styled at http://localhost:1420/ without the Rust side. It is a
 * stand-in, not a spec: the real behaviour lives in `src-tauri/crates/*`.
 *
 * Starts with no vault open, so onboarding shows. `vault_create` and
 * `vault_open` both load the sample notes below (`vault_open` also seeds a
 * short backup history, so the history UI has something to show).
 *
 * Only reached through `browser-preview.ts`, which is itself only imported
 * behind `import.meta.env.DEV`, so production builds never contain it.
 */
import {
  EVENTS,
  type Backlink,
  type BackupStatus,
  type CoreError,
  type DbEncryption,
  type DbStatus,
  type FsChangedPayload,
  type Heading,
  type IndexStatus,
  type JsonValue,
  type LinkTarget,
  type Note,
  type NoteRef,
  type QuickOpenItem,
  type RenameResult,
  type SearchHit,
  type SnapshotInfo,
  type TextPart,
  type TreeNode,
  type VaultInfo,
  type WriteResult,
} from '$lib/tauri-bindings'

type Args = Record<string, unknown>
type CommandHandler = (args: Args) => unknown

export interface FakeVaultOptions {
  /** Stands in for Rust's `app.emit(...)`. */
  emitEvent: (event: string, payload: unknown) => unknown
  /** Clock, in ms since the epoch. Injectable for tests. */
  now?: () => number
  /** Runs `fn` later; drives the fake reindex progress. */
  schedule?: (fn: () => void, ms: number) => void
}

export interface FakeVault {
  /** Every P1 command, keyed by its Rust name. */
  handlers: Record<string, CommandHandler>
  /**
   * Simulates an edit made outside the app (another editor, a sync client)
   * to the open vault: writes `content`, or removes the file for `null`,
   * then emits `vault:fs-changed` the way the Rust watcher does.
   */
  externalEdit: (path: string, content: string | null) => void
}

interface FileEntry {
  content: string
  mtime: number
}

interface Snapshot {
  info: SnapshotInfo
  files: Map<string, string>
}

interface TrashItem {
  /** Vault-relative paths inside the trashed item, relative to its parent. */
  files: [string, FileEntry][]
  folders: string[]
}

interface VaultData {
  /** Every file, keyed by vault-relative path. */
  files: Map<string, FileEntry>
  /** Every folder (explicit or implied by a file), with its mtime. */
  folders: Map<string, number>
  trash: Map<string, TrashItem>
  backup: {
    initialized: boolean
    remote: string | null
    ahead: number
    /** Oldest first. */
    snapshots: Snapshot[]
  }
  indexing: boolean
}

const DAY = 24 * 60 * 60 * 1000
const DEFAULT_LIMIT = 50
const CONTEXT_MAX = 300
const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
})

// --- Sample vault -----------------------------------------------------------

/** `[path, content, age in days]`. Paths are vault-relative. */
const SAMPLE_NOTES: [string, string, number][] = [
  [
    'Welcome.md',
    `---
title: Welcome to Ostralith
tags: [meta, start-here]
created: 2026-09-01
---
# Welcome to Ostralith

Your notes are plain Markdown files in this folder. Ostralith indexes them
so you can search, link and back them up.

## First steps

- [x] Open the sample vault
- [ ] Read [[Getting Started]]
- [ ] Skim [[Projects/Ostralith Roadmap|the roadmap]]
- [ ] Check yesterday's [[Daily/2026-09-29#Standup|standup]]

## Where things live

Daily notes go in \`Daily/\`, projects in \`Projects/\`. #meta
`,
    0.1,
  ],
  [
    'Getting Started.md',
    `# Getting Started

Back to [[Welcome]].

## Linking

Type \`[[\` to link another note, e.g. [[Markdown Cheatsheet]]. Links to
notes that don't exist yet, like [[Nonexistent Note]], show as unresolved.

### Headings and aliases

Link to a heading with [[Markdown Cheatsheet#Code blocks]] or give a link
its own text: [[Welcome|the welcome page]].

## Searching

Press the quick-open shortcut and start typing. #howto
`,
    1,
  ],
  [
    'Markdown Cheatsheet.md',
    `---
tags:
  - reference
  - howto
---
# Markdown Cheatsheet

## Emphasis

*italic*, **bold**, ~~strike~~, \`code\`.

## Lists

1. First
2. Second
   - Nested

## Code blocks

\`\`\`md
# This is not a heading
[[Not a link either]]
\`\`\`

## Tables

| Key | Value |
| --- | ----- |
| a   | 1     |
`,
    6,
  ],
  [
    'Ideas.md',
    `# Ideas

- Offline-first sync over [[Someday Maybe]]
- Spaced repetition from highlighted notes #idea
- A graph view that isn't a hairball #idea #ux
`,
    0.5,
  ],
  [
    'Projects/Ostralith Roadmap.md',
    `---
status: active
owner: me
priority: 1
---
# Ostralith Roadmap

## P1: Vault

- [x] Vault registry
- [x] File tree
- [ ] Editor with backlinks
- [ ] Git backups

## Later

See [[Local-first Software]] and the notes from
[[Meeting Notes 2026-09-15]].
`,
    2,
  ],
  [
    'Projects/Garden Planner.md',
    `# Garden Planner

## Spring

- [ ] Order seeds #home
- [ ] Build the raised bed
- [x] Test the soil

## Autumn

- [ ] Plant garlic
`,
    12,
  ],
  [
    'Projects/Research/Local-first Software.md',
    `---
tags: [research]
source: https://www.inkandswitch.com/local-first/
---
# Local-first Software

## Principles

1. No spinners
2. Your work is not trapped on one device
3. The network is optional

## Notes

Ties back to [[Welcome]]. #research
`,
    9,
  ],
  [
    'Projects/Research/CRDT Reading List.md',
    `# CRDT Reading List

Start with [[Local-first Software#Principles]].

- Automerge
- Yjs
- Peritext #research
`,
    8,
  ],
  [
    'Daily/2026-09-28.md',
    `# 2026-09-28

Quiet day. Sketched [[Ideas]].
`,
    2,
  ],
  [
    'Daily/2026-09-29.md',
    `# 2026-09-29

## Standup

- Finished the file tree
- Next: backlinks for [[Projects/Ostralith Roadmap]]

## Log

Lunch with Sam.
`,
    1,
  ],
  [
    'Daily/2026-09-30.md',
    `# 2026-09-30

## Standup

- [ ] Review [[CRDT Reading List]]
`,
    0.05,
  ],
  [
    'Meetings/Meeting Notes 2026-09-15.md',
    `---
attendees: [Sam, Alex]
---
# Meeting Notes 2026-09-15

## Decisions

- Markdown files stay the source of truth.
- The database is only a cache. See [[Ostralith Roadmap]].
`,
    15,
  ],
  [
    'Reading/Chapter 2.md',
    `# Chapter 2

Summary of chapter two. Related: [[Local-first Software|LFS paper]].
`,
    20,
  ],
  [
    'Reading/Chapter 10.md',
    `# Chapter 10

Summary of chapter ten. #reading
`,
    19,
  ],
]

/** Non-note files: an attachment the tree shows, and a dotfile it hides. */
const SAMPLE_FILES: [string, string, number][] = [
  ['Attachments/architecture.png', '\u0089PNG (binary placeholder)', 7],
  ['.DS_Store', '', 30],
]

/** An older revision of the roadmap, for the seeded backup history. */
const ROADMAP_V1 = `# Ostralith Roadmap

## P1: Vault

- [ ] Vault registry
- [ ] File tree
`

function sampleVault(now: number, withHistory: boolean): VaultData {
  const data: VaultData = {
    files: new Map(),
    folders: new Map(),
    trash: new Map(),
    backup: { initialized: false, remote: null, ahead: 0, snapshots: [] },
    indexing: false,
  }
  for (const [path, content, age] of [...SAMPLE_NOTES, ...SAMPLE_FILES]) {
    const mtime = Math.round(now - age * DAY)
    data.files.set(path, { content, mtime })
    ensureFolders(data, parentOf(path), mtime)
  }
  if (withHistory) {
    const first = currentContents(data)
    first.set('Projects/Ostralith Roadmap.md', ROADMAP_V1)
    first.delete('Ideas.md')
    first.delete('Daily/2026-09-30.md')
    const second = currentContents(data)
    second.delete('Ideas.md')
    data.backup.initialized = true
    data.backup.snapshots = [
      snapshot('Initial snapshot', now - 3 * DAY, first, first.size),
      snapshot('Snapshot', now - DAY, second, 2),
    ]
  }
  return data
}

// --- Small helpers ----------------------------------------------------------

function fail(error: CoreError): never {
  throw error
}

const invalid = (message: string): CoreError => ({
  kind: 'invalidInput',
  message,
})

function str(args: Args, key: string): string {
  const value = args[key]
  if (typeof value !== 'string') fail(invalid(`${key} must be a string`))
  return value
}

function optStr(args: Args, key: string): string | null {
  const value = args[key]
  if (value == null) return null
  if (typeof value !== 'string') fail(invalid(`${key} must be a string`))
  return value
}

function limitArg(args: Args): number {
  const value = args.limit
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : DEFAULT_LIMIT
}

/** Validates a vault-relative path the way the Rust side will. */
function vaultPath(raw: string): string {
  const path = raw.trim().replace(/\/+$/, '')
  if (!path) fail(invalid('path must not be empty'))
  const segments = path.split('/')
  if (
    path.startsWith('/') ||
    /^[a-zA-Z]:/.test(path) ||
    path.includes('\\') ||
    segments.some((s) => s === '..' || s === '.')
  ) {
    fail({ kind: 'pathOutsideVault', path: raw })
  }
  if (segments.some((s) => s === '')) fail(invalid(`invalid path: ${raw}`))
  return path
}

function parentOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function joinPath(folder: string, name: string): string {
  return folder ? `${folder}/${name}` : name
}

function stem(path: string): string {
  const name = baseName(path)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

function isNote(path: string): boolean {
  return path.toLowerCase().endsWith('.md')
}

function isHidden(path: string): boolean {
  return path.split('/').some((s) => s.startsWith('.'))
}

function hasExtension(target: string): boolean {
  return /\.[A-Za-z0-9]{1,8}$/.test(baseName(target))
}

function isUnder(path: string, folder: string): boolean {
  return path.startsWith(`${folder}/`)
}

function ensureFolders(data: VaultData, folder: string, mtime: number): void {
  for (let f = folder; f; f = parentOf(f)) {
    if (!data.folders.has(f)) data.folders.set(f, mtime)
  }
}

function exists(data: VaultData, path: string): boolean {
  return data.files.has(path) || data.folders.has(path)
}

/** Case-insensitive, like the default macOS and Windows file systems. */
function taken(data: VaultData, path: string): boolean {
  const lower = path.toLowerCase()
  for (const p of data.files.keys()) if (p.toLowerCase() === lower) return true
  for (const p of data.folders.keys())
    if (p.toLowerCase() === lower) return true
  return false
}

/** A stand-in for blake3: 64 hex chars, stable for equal content. */
function fakeHash(content: string): string {
  let out = ''
  for (let seed = 0; seed < 8; seed++) {
    let h = 0x811c9dc5 ^ seed
    for (let i = 0; i < content.length; i++) {
      h ^= content.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
    out += (h >>> 0).toString(16).padStart(8, '0')
  }
  return out
}

let idCounter = 0

function fakeUuid(): string {
  const hex = fakeHash(`${Date.now()}:${Math.random()}:${idCounter++}`)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

// --- Markdown -----------------------------------------------------------

interface Split {
  frontmatter: Record<string, JsonValue> | null
  /** Index of the first body line. */
  bodyLine: number
  lines: string[]
}

function parseScalar(raw: string): JsonValue {
  const value = raw.trim()
  if (/^(["']).*\1$/.test(value)) return value.slice(1, -1)
  if (value === 'true' || value === 'false') return value === 'true'
  if (value === '' || value === '~' || value === 'null') return null
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value)
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim()
    return inner ? inner.split(',').map((v) => parseScalar(v)) : []
  }
  return value
}

/** A deliberately small YAML subset: scalars, inline and block lists. */
function parseFrontmatter(lines: string[]): Record<string, JsonValue> {
  const out: Record<string, JsonValue> = {}
  let listKey: string | null = null
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    const item = /^\s+-\s+(.*)$/.exec(line)
    if (item && listKey) {
      const list = out[listKey]
      if (Array.isArray(list)) list.push(parseScalar(item[1] ?? ''))
      continue
    }
    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (!pair) continue
    const [, key = '', value = ''] = pair
    listKey = value.trim() ? null : key
    out[key] = value.trim() ? parseScalar(value) : []
  }
  return out
}

function splitNote(content: string): Split {
  const lines = content.split(/\r?\n/)
  if (lines[0] === '---') {
    const end = lines.findIndex((l, i) => i > 0 && (l === '---' || l === '...'))
    if (end > 0) {
      return {
        frontmatter: parseFrontmatter(lines.slice(1, end)),
        bodyLine: end + 1,
        lines,
      }
    }
  }
  return { frontmatter: null, bodyLine: 0, lines }
}

const HEADING_RE = /^(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/
function matchHeading(line: string): { level: number; text: string } | null {
  const m = HEADING_RE.exec(line)
  const hashes = m?.[1]
  const text = m?.[2]
  return hashes && text ? { level: hashes.length, text } : null
}

const FENCE_RE = /^\s*(```|~~~)/

/** Visits each body line outside fenced code blocks. */
function forEachProseLine(
  split: Split,
  visit: (line: string, index: number) => void,
): void {
  let fence: string | null = null
  for (let i = split.bodyLine; i < split.lines.length; i++) {
    const line = split.lines[i] ?? ''
    const open = FENCE_RE.exec(line)
    if (open) {
      if (fence === null) fence = open[1] ?? null
      else if (open[1] === fence) fence = null
      continue
    }
    if (fence === null) visit(line, i)
  }
}

function slugOf(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
}

function outline(content: string): Heading[] {
  const headings: Heading[] = []
  const seen = new Map<string, number>()
  forEachProseLine(splitNote(content), (line, index) => {
    const h = matchHeading(line)
    if (!h) return
    const base = slugOf(h.text)
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    headings.push({
      level: h.level,
      text: h.text,
      line: index,
      slug: n === 0 ? base : `${base}-${n}`,
    })
  })
  return headings
}

function titleOf(path: string, content: string): string {
  const split = splitNote(content)
  const fmTitle = split.frontmatter?.title
  if (typeof fmTitle === 'string' && fmTitle.trim()) return fmTitle.trim()
  let h1: string | null = null
  forEachProseLine(split, (line) => {
    const h = matchHeading(line)
    if (h1 === null && h?.level === 1) h1 = h.text
  })
  return h1 ?? stem(path)
}

function tagsOf(content: string): string[] {
  const split = splitNote(content)
  const tags = new Set<string>()
  const fmTags = split.frontmatter?.tags
  for (const t of Array.isArray(fmTags) ? fmTags : [fmTags]) {
    if (typeof t === 'string' && t) tags.add(t.toLowerCase())
  }
  forEachProseLine(split, (line) => {
    for (const m of line.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)) {
      if (m[1]) tags.add(m[1].toLowerCase())
    }
  })
  return [...tags]
}

const WIKILINK_RE = /(!?)\[\[([^\]\n]+?)\]\]/g

interface ParsedTarget {
  pathPart: string
  heading: string | null
  alias: string | null
}

function parseTarget(raw: string): ParsedTarget {
  const pipe = raw.indexOf('|')
  const target = pipe < 0 ? raw : raw.slice(0, pipe)
  const alias = pipe < 0 ? null : raw.slice(pipe + 1)
  const hash = target.indexOf('#')
  return {
    pathPart: (hash < 0 ? target : target.slice(0, hash)).trim(),
    heading: hash < 0 ? null : target.slice(hash + 1).trim() || null,
    alias,
  }
}

/**
 * Obsidian-style lookup: exact path first, then a case-insensitive match on
 * the basename (or a trailing partial path); the shortest path wins.
 */
function findTarget(paths: Iterable<string>, pathPart: string): string | null {
  const wanted = hasExtension(pathPart) ? pathPart : `${pathPart}.md`
  const all = [...paths].filter((p) => !isHidden(p))
  if (all.includes(wanted)) return wanted
  const lower = wanted.toLowerCase()
  const matches = all.filter((p) => {
    const lp = p.toLowerCase()
    return lp === lower || lp.endsWith(`/${lower}`)
  })
  matches.sort((a, b) => a.length - b.length || collator.compare(a, b))
  return matches[0] ?? null
}

function resolveTarget(
  paths: Iterable<string>,
  fromPath: string,
  raw: string,
): LinkTarget {
  const { pathPart, heading } = parseTarget(raw)
  if (!pathPart) return { raw, path: fromPath, heading, exists: true }
  const found = findTarget(paths, pathPart)
  if (found) return { raw, path: found, heading, exists: true }
  const path = hasExtension(pathPart) ? pathPart : `${pathPart}.md`
  return { raw, path, heading, exists: false }
}

// --- Highlighting -----------------------------------------------------------

function toParts(chars: string[], marked: Set<number>): TextPart[] {
  const parts: TextPart[] = []
  chars.forEach((ch, i) => {
    const highlight = marked.has(i)
    const last = parts[parts.length - 1]
    if (last && last.highlight === highlight) last.text += ch
    else parts.push({ text: ch, highlight })
  })
  return parts
}

const plain = (text: string): TextPart[] =>
  text ? [{ text, highlight: false }] : []

interface FuzzyMatch {
  score: number
  parts: TextPart[]
}

/** Greedy case-insensitive subsequence match, rewarding runs and word starts. */
function fuzzy(query: string, text: string): FuzzyMatch | null {
  const needle = Array.from(query.toLowerCase()).filter((c) => c.trim())
  const chars = Array.from(text)
  const lower = chars.map((c) => c.toLowerCase())
  const marked = new Set<number>()
  let score = 0
  let qi = 0
  let prev = -2
  for (let i = 0; i < lower.length && qi < needle.length; i++) {
    if (lower[i] !== needle[qi]) continue
    score += 1
    if (prev === i - 1) score += 3
    if (i === 0 || /[\s/_\-.]/.test(chars[i - 1] ?? '')) score += 2
    marked.add(i)
    prev = i
    qi++
  }
  if (qi < needle.length) return null
  return { score: score - chars.length * 0.01, parts: toParts(chars, marked) }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

interface SearchQuery {
  terms: string[]
  tags: string[]
  paths: string[]
}

function parseQuery(query: string): SearchQuery {
  const out: SearchQuery = { terms: [], tags: [], paths: [] }
  for (const m of query.matchAll(/(\w+):("[^"]*"|\S+)|"([^"]*)"|(\S+)/g)) {
    if (m[1]) {
      const value = (m[2] ?? '').replace(/^"|"$/g, '').toLowerCase()
      if (m[1].toLowerCase() === 'tag') out.tags.push(value.replace(/^#/, ''))
      else if (m[1].toLowerCase() === 'path') out.paths.push(value)
      else out.terms.push(m[0])
    } else {
      const term = m[3] ?? m[4]
      if (term) out.terms.push(term)
    }
  }
  return out
}

function snippetOf(body: string, terms: string[]): TextPart[] {
  const text = body.replace(/\s+/g, ' ').trim()
  const re = terms.length
    ? new RegExp(terms.map(escapeRegExp).join('|'), 'giu')
    : null
  const first = re ? re.exec(text) : null
  let start = first ? Math.max(0, first.index - 60) : 0
  if (start > 0) start = text.indexOf(' ', start) + 1 || start
  const end = Math.min(text.length, start + 180)
  const window = text.slice(start, end)
  const parts: TextPart[] = []
  if (start > 0) parts.push({ text: '…', highlight: false })
  let at = 0
  if (re) {
    // `matchAll` copies `lastIndex`, which the `exec` above advanced.
    re.lastIndex = 0
    for (const m of window.matchAll(re)) {
      if (!m[0]) continue
      parts.push(...plain(window.slice(at, m.index)))
      parts.push({ text: m[0], highlight: true })
      at = m.index + m[0].length
    }
  }
  parts.push(...plain(window.slice(at)))
  if (end < text.length) parts.push({ text: '…', highlight: false })
  return parts
}

// --- Backups ----------------------------------------------------------------

function snapshot(
  message: string,
  time: number,
  files: Map<string, string>,
  filesChanged: number,
): Snapshot {
  return {
    info: {
      id: fakeHash(`${message}:${time}:${idCounter++}`).slice(0, 40),
      message,
      time: Math.round(time),
      filesChanged,
    },
    files,
  }
}

function currentContents(data: VaultData): Map<string, string> {
  const out = new Map<string, string>()
  for (const [path, entry] of data.files) {
    if (!isHidden(path)) out.set(path, entry.content)
  }
  return out
}

function changedCount(
  now: Map<string, string>,
  before: Map<string, string> | undefined,
): number {
  if (!before) return now.size
  let n = 0
  for (const [path, content] of now) if (before.get(path) !== content) n++
  for (const path of before.keys()) if (!now.has(path)) n++
  return n
}

// --- The handler table ------------------------------------------------------

/**
 * Builds the handlers for every P1 command, keyed by the Rust command name.
 * Session state lives in the closure. Failures throw a plain `CoreError`,
 * which the generated bindings turn into `{ status: 'error', error }`.
 */
export function createFakeVault(options: FakeVaultOptions): FakeVault {
  const { emitEvent } = options
  const now = options.now ?? Date.now
  const schedule =
    options.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))

  let registry: VaultInfo[] = []
  const vaults = new Map<string, VaultData>()
  let current: VaultInfo | null = null

  const vault = (): VaultData => {
    const data = current && vaults.get(current.id)
    return data || fail({ kind: 'noVault' })
  }

  const setCurrent = (info: VaultInfo | null): void => {
    current = info
    void emitEvent(EVENTS.vaultCurrentChanged, info ? { ...info } : null)
  }

  const open = (info: VaultInfo): VaultInfo => {
    const opened = { ...info, lastOpenedAt: now() }
    registry = [opened, ...registry.filter((v) => v.id !== info.id)]
    setCurrent(opened)
    return { ...opened }
  }

  const noteCount = (data: VaultData): number =>
    [...data.files.keys()].filter((p) => isNote(p) && !isHidden(p)).length

  const visibleNotes = (data: VaultData) =>
    [...data.files]
      .filter(([p]) => isNote(p) && !isHidden(p))
      .map(([path, entry]) => ({
        path,
        entry,
        title: titleOf(path, entry.content),
      }))

  const tree = (data: VaultData, parent: string): TreeNode[] => {
    const folders: TreeNode[] = [...data.folders]
      .filter(([p]) => parentOf(p) === parent && !isHidden(p))
      .map(([path, mtime]): TreeNode => ({
        path,
        name: baseName(path),
        kind: 'folder',
        mtime,
        children: tree(data, path),
      }))
    const files: TreeNode[] = [...data.files]
      .filter(([p]) => parentOf(p) === parent && !isHidden(p))
      .map(([path, entry]): TreeNode => ({
        path,
        name: baseName(path),
        kind: isNote(path) ? 'note' : 'file',
        mtime: entry.mtime,
        children: [],
      }))
    const byName = (a: TreeNode, b: TreeNode) =>
      collator.compare(a.name, b.name)
    return [...folders.sort(byName), ...files.sort(byName)]
  }

  const write = (
    data: VaultData,
    path: string,
    content: string,
  ): WriteResult => {
    const mtime = now()
    data.files.set(path, { content, mtime })
    ensureFolders(data, parentOf(path), mtime)
    return { path, mtime, hash: fakeHash(content) }
  }

  const uniqueName = (
    data: VaultData,
    folder: string,
    base: string,
    ext: string,
  ) => {
    for (let n = 0; ; n++) {
      const name = n === 0 ? `${base}${ext}` : `${base} ${n}${ext}`
      const path = joinPath(folder, name)
      if (!taken(data, path)) return path
    }
  }

  const backupStatus = (data: VaultData): BackupStatus => {
    const { initialized, snapshots, remote, ahead } = data.backup
    const last = snapshots[snapshots.length - 1]
    return {
      initialized,
      changedFiles: initialized
        ? changedCount(currentContents(data), last?.files)
        : 0,
      lastSnapshot: last ? { ...last.info } : null,
      remote,
      ahead,
    }
  }

  /** Commits every change; `null` when there is nothing to commit. */
  const takeSnapshot = (
    data: VaultData,
    message: string | null,
  ): SnapshotInfo | null => {
    if (!data.backup.initialized) {
      fail(invalid('Backups are not set up for this vault'))
    }
    const files = currentContents(data)
    const last = data.backup.snapshots[data.backup.snapshots.length - 1]
    const changed = changedCount(files, last?.files)
    if (changed === 0) return null
    const time = now()
    const snap = snapshot(
      message?.trim() ||
        `Snapshot ${new Date(time).toISOString().slice(0, 16)}`,
      time,
      files,
      changed,
    )
    data.backup.snapshots.push(snap)
    if (data.backup.remote) data.backup.ahead++
    return { ...snap.info }
  }

  const indexStatus = (): IndexStatus => {
    const data = current && vaults.get(current.id)
    if (!data) return { indexing: false, done: 0, total: 0, noteCount: 0 }
    const count = noteCount(data)
    return {
      indexing: data.indexing,
      done: data.indexing ? 0 : count,
      total: count,
      noteCount: count,
    }
  }

  const handlers: Record<string, CommandHandler> = {
    // --- Vault lifecycle ----------------------------------------------------
    vault_list: () => registry.map((v) => ({ ...v })),
    vault_current: () => (current ? { ...current } : null),
    vault_create: (args) => {
      const parentDir = str(args, 'parentDir')
        .trim()
        .replace(/[\\/]+$/, '')
      const name = str(args, 'name').trim()
      const encryption = args.encryption as DbEncryption
      if (!parentDir) fail(invalid('parentDir must not be empty'))
      if (!name || /[\\/]/.test(name))
        fail(invalid(`invalid vault name: ${name}`))
      if (encryption !== 'none' && encryption !== 'keychain') {
        fail(invalid(`unknown encryption ${String(encryption)}`))
      }
      const path = `${parentDir}/${name}`
      if (registry.some((v) => v.path === path)) {
        fail({ kind: 'alreadyExists', path })
      }
      const info: VaultInfo = {
        id: fakeUuid(),
        name,
        path,
        encryption,
        lastOpenedAt: now(),
      }
      vaults.set(info.id, sampleVault(now(), false))
      return open(info)
    },
    vault_open: (args) => {
      const path = str(args, 'path')
        .trim()
        .replace(/(.)[\\/]+$/, '$1')
      if (!path) fail(invalid('path must not be empty'))
      const known = registry.find((v) => v.path === path)
      const info: VaultInfo = known ?? {
        id: fakeUuid(),
        name: baseName(path.replace(/\\/g, '/')) || path,
        path,
        encryption: 'none',
        lastOpenedAt: now(),
      }
      if (!vaults.has(info.id)) vaults.set(info.id, sampleVault(now(), true))
      return open(info)
    },
    vault_open_by_id: (args) => {
      const id = str(args, 'id')
      const known = registry.find((v) => v.id === id)
      if (!known || !vaults.has(id))
        fail({ kind: 'notFound', what: `Vault ${id}` })
      return open(known)
    },
    vault_close: () => {
      if (current) setCurrent(null)
      return null
    },
    vault_forget: (args) => {
      const id = str(args, 'id')
      registry = registry.filter((v) => v.id !== id)
      vaults.delete(id)
      if (current?.id === id) setCurrent(null)
      return null
    },

    // --- Files --------------------------------------------------------------
    list_tree: () => tree(vault(), ''),
    read_note: (args): Note => {
      const data = vault()
      const path = vaultPath(str(args, 'path'))
      const entry = data.files.get(path)
      if (!entry) fail({ kind: 'notFound', what: path })
      if (!isNote(path)) fail(invalid(`${path} is not a note`))
      return {
        path,
        title: titleOf(path, entry.content),
        content: entry.content,
        frontmatter: splitNote(entry.content).frontmatter,
        mtime: entry.mtime,
        hash: fakeHash(entry.content),
      }
    },
    write_note: (args): WriteResult => {
      const data = vault()
      const path = vaultPath(str(args, 'path'))
      const content = str(args, 'content')
      const expected = optStr(args, 'expectedHash')
      if (!isNote(path)) fail(invalid(`${path} is not a note`))
      if (data.folders.has(path)) fail({ kind: 'alreadyExists', path })
      // A file that vanished since it was read is a conflict too.
      const existing = data.files.get(path)
      if (
        expected !== null &&
        (!existing || fakeHash(existing.content) !== expected)
      ) {
        fail({ kind: 'conflict', path })
      }
      return write(data, path, content)
    },
    create_note: (args): NoteRef => {
      const data = vault()
      const rawFolder = optStr(args, 'folder')
      const folder = rawFolder ? vaultPath(rawFolder) : ''
      if (folder && !data.folders.has(folder)) {
        fail({ kind: 'notFound', what: folder })
      }
      const title = optStr(args, 'title')?.trim() || null
      const base =
        title
          ?.replace(/[\\/:*?"<>|#^[\]]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim() || 'Untitled'
      const path = uniqueName(data, folder, base, '.md')
      write(data, path, title ? `# ${title}\n\n` : '')
      return { path, title: title ?? stem(path) }
    },
    create_folder: (args) => {
      const data = vault()
      const path = vaultPath(str(args, 'path'))
      if (taken(data, path)) fail({ kind: 'alreadyExists', path })
      const parent = parentOf(path)
      if (data.files.has(parent)) fail(invalid(`${parent} is not a folder`))
      ensureFolders(data, path, now())
      return null
    },
    rename_path: (args): RenameResult => {
      const data = vault()
      const from = vaultPath(str(args, 'from'))
      const to = vaultPath(str(args, 'to'))
      if (!exists(data, from)) fail({ kind: 'notFound', what: from })
      if (from === to) return { path: to, updatedLinks: 0, updatedFiles: 0 }
      if (taken(data, to) && to.toLowerCase() !== from.toLowerCase()) {
        fail({ kind: 'alreadyExists', path: to })
      }
      if (isUnder(to, from)) fail(invalid(`can't move ${from} into itself`))

      const oldPaths = [...data.files.keys()]
      const moved = new Map<string, string>()
      const movePath = (p: string) =>
        p === from ? to : isUnder(p, from) ? to + p.slice(from.length) : p
      for (const p of oldPaths) if (movePath(p) !== p) moved.set(p, movePath(p))

      // Resolve every link against the old tree before anything moves.
      const selfNote = data.files.has(from) ? from : null
      const newPaths = oldPaths.map((p) => moved.get(p) ?? p)
      const rewrites = new Map<string, string>()
      let updatedLinks = 0
      for (const [source, entry] of data.files) {
        if (!isNote(source) || source === selfNote) continue
        let count = 0
        const next = entry.content.replace(
          WIKILINK_RE,
          (whole, bang: string, raw: string) => {
            const { pathPart, heading, alias } = parseTarget(raw)
            if (!pathPart) return whole
            const target = findTarget(oldPaths, pathPart)
            const dest = target && moved.get(target)
            if (!dest) return whole
            const short = hasExtension(pathPart) ? baseName(dest) : stem(dest)
            const long = hasExtension(pathPart)
              ? dest
              : dest.replace(/\.md$/i, '')
            const usesBasename =
              !pathPart.includes('/') && findTarget(newPaths, short) === dest
            let text = usesBasename ? short : long
            if (heading) text += `#${heading}`
            if (alias !== null) text += `|${alias}`
            if (text === raw) return whole
            count++
            return `${bang}[[${text}]]`
          },
        )
        if (count) {
          rewrites.set(source, next)
          updatedLinks += count
        }
      }

      const time = now()
      for (const [oldPath, newPath] of moved) {
        const entry = data.files.get(oldPath)
        data.files.delete(oldPath)
        if (entry) data.files.set(newPath, entry)
      }
      for (const [folder, mtime] of [...data.folders]) {
        const next = movePath(folder)
        if (next !== folder) {
          data.folders.delete(folder)
          data.folders.set(next, mtime)
        }
      }
      ensureFolders(data, parentOf(to), time)
      for (const [source, content] of rewrites) {
        data.files.set(movePath(source), { content, mtime: time })
      }
      return { path: to, updatedLinks, updatedFiles: rewrites.size }
    },
    trash_path: (args) => {
      const data = vault()
      const path = vaultPath(str(args, 'path'))
      if (!exists(data, path)) fail({ kind: 'notFound', what: path })
      const name = baseName(path)
      const dot = data.files.has(path) ? name.lastIndexOf('.') : -1
      let trashName = name
      for (let n = 1; data.trash.has(trashName); n++) {
        trashName =
          dot > 0
            ? `${name.slice(0, dot)} ${n}${name.slice(dot)}`
            : `${name} ${n}`
      }
      const item: TrashItem = { files: [], folders: [] }
      for (const [p, entry] of [...data.files]) {
        if (p === path || isUnder(p, path)) {
          item.files.push([p, entry])
          data.files.delete(p)
        }
      }
      for (const p of [...data.folders.keys()]) {
        if (p === path || isUnder(p, path)) {
          item.folders.push(p)
          data.folders.delete(p)
        }
      }
      data.trash.set(trashName, item)
      return null
    },

    // --- Links and outline --------------------------------------------------
    get_backlinks: (args): Backlink[] => {
      const data = vault()
      const path = vaultPath(str(args, 'path'))
      const paths = [...data.files.keys()]
      const out: Backlink[] = []
      for (const { path: source, entry, title } of visibleNotes(data)) {
        if (source === path) continue
        forEachProseLine(splitNote(entry.content), (line, index) => {
          for (const m of line.matchAll(WIKILINK_RE)) {
            if (resolveTarget(paths, source, m[2] ?? '').path === path) {
              out.push({
                sourcePath: source,
                sourceTitle: title,
                line: index,
                context: line.trim().slice(0, CONTEXT_MAX),
              })
              return
            }
          }
        })
      }
      return out.sort(
        (a, b) =>
          collator.compare(a.sourceTitle, b.sourceTitle) || a.line - b.line,
      )
    },
    get_outline: (args) => outline(str(args, 'content')),
    resolve_link: (args): LinkTarget => {
      const data = vault()
      const fromPath = vaultPath(str(args, 'fromPath'))
      return resolveTarget(data.files.keys(), fromPath, str(args, 'target'))
    },

    // --- Search -------------------------------------------------------------
    quick_open: (args): QuickOpenItem[] => {
      const notes = visibleNotes(vault())
      const query = str(args, 'query').trim()
      const limit = limitArg(args)
      if (!query) {
        return notes
          .sort((a, b) => b.entry.mtime - a.entry.mtime)
          .slice(0, limit)
          .map(({ path, title }) => ({
            path,
            title,
            score: 0,
            titleParts: plain(title),
            pathParts: plain(path),
          }))
      }
      const ranked: { item: QuickOpenItem; mtime: number }[] = []
      for (const { path, title, entry } of notes) {
        const inTitle = fuzzy(query, title)
        const inPath = fuzzy(query, path)
        if (!inTitle && !inPath) continue
        ranked.push({
          item: {
            path,
            title,
            score: Math.max((inTitle?.score ?? 0) * 1.5, inPath?.score ?? 0),
            titleParts: inTitle?.parts ?? plain(title),
            pathParts: inPath?.parts ?? plain(path),
          },
          mtime: entry.mtime,
        })
      }
      return ranked
        .sort(
          (a, b) =>
            b.item.score - a.item.score ||
            b.mtime - a.mtime ||
            collator.compare(a.item.path, b.item.path),
        )
        .slice(0, limit)
        .map(({ item }) => item)
    },
    search_fulltext: (args): SearchHit[] => {
      const notes = visibleNotes(vault())
      const { terms, tags, paths } = parseQuery(str(args, 'query'))
      if (!terms.length && !tags.length && !paths.length) return []
      const hits: SearchHit[] = []
      for (const { path, title, entry } of notes) {
        if (paths.some((p) => !path.toLowerCase().includes(p))) continue
        if (tags.length) {
          const noteTags = tagsOf(entry.content)
          const hasTag = (t: string) =>
            noteTags.some((n) => n === t || n.startsWith(`${t}/`))
          if (!tags.every(hasTag)) continue
        }
        const split = splitNote(entry.content)
        const body = split.lines.slice(split.bodyLine).join('\n')
        let score = 0
        let all = true
        for (const term of terms) {
          const re = new RegExp(escapeRegExp(term), 'giu')
          const n =
            (body.match(re)?.length ?? 0) + 5 * (title.match(re)?.length ?? 0)
          if (n === 0) all = false
          score += n
        }
        if (!all) continue
        hits.push({
          path,
          title,
          score: terms.length ? score : 1,
          snippet: snippetOf(body, terms),
        })
      }
      return hits
        .sort((a, b) => b.score - a.score || collator.compare(a.path, b.path))
        .slice(0, limitArg(args))
    },
    index_status: () => indexStatus(),
    reindex: () => {
      const data = vault()
      if (data.indexing) return null
      const total = noteCount(data)
      data.indexing = true
      void emitEvent(EVENTS.indexStatus, {
        indexing: true,
        done: 0,
        total,
        noteCount: total,
      } satisfies IndexStatus)
      const half = Math.floor(total / 2)
      schedule(() => {
        void emitEvent(EVENTS.indexStatus, {
          indexing: true,
          done: half,
          total,
          noteCount: total,
        } satisfies IndexStatus)
        schedule(() => {
          data.indexing = false
          void emitEvent(EVENTS.indexStatus, indexStatus())
        }, 400)
      }, 400)
      return null
    },

    // --- Database -----------------------------------------------------------
    db_status: (): DbStatus => {
      const data = vault()
      let bytes = 0
      for (const entry of data.files.values()) bytes += entry.content.length
      return {
        encryption: current?.encryption ?? 'none',
        sizeBytes: 64 * 1024 + bytes * 3,
        schemaVersion: 1,
        noteCount: noteCount(data),
        integrityOk: true,
      }
    },

    // --- Backups ------------------------------------------------------------
    backup_status: () => backupStatus(vault()),
    backup_init: () => {
      const data = vault()
      data.backup.initialized = true
      return backupStatus(data)
    },
    backup_now: (args) => takeSnapshot(vault(), optStr(args, 'message')),
    backup_set_remote: (args) => {
      const data = vault()
      const url = optStr(args, 'url')?.trim() || null
      data.backup.remote = url
      data.backup.ahead = 0
      return backupStatus(data)
    },
    note_history: (args): SnapshotInfo[] => {
      const data = vault()
      const path = vaultPath(str(args, 'path'))
      const snaps = data.backup.snapshots
      return snaps
        .filter((s, i) => s.files.get(path) !== snaps[i - 1]?.files.get(path))
        .reverse()
        .slice(0, limitArg(args))
        .map((s) => ({ ...s.info }))
    },
    note_restore: (args): WriteResult => {
      const data = vault()
      const path = vaultPath(str(args, 'path'))
      const id = str(args, 'snapshotId')
      const snap = data.backup.snapshots.find((s) => s.info.id === id)
      if (!snap) fail({ kind: 'notFound', what: `Snapshot ${id}` })
      const content = snap.files.get(path)
      if (content === undefined) fail({ kind: 'notFound', what: path })
      takeSnapshot(data, `Before restoring ${path}`)
      return write(data, path, content)
    },
  }

  const externalEdit = (rawPath: string, content: string | null): void => {
    const data = vault()
    const path = vaultPath(rawPath)
    const existed = data.files.has(path)
    if (content === null) {
      if (!existed) fail({ kind: 'notFound', what: path })
      data.files.delete(path)
    } else {
      write(data, path, content)
    }
    const payload: FsChangedPayload = {
      changes: [
        {
          path,
          kind: content === null ? 'removed' : existed ? 'modified' : 'created',
          oldPath: null,
        },
      ],
    }
    void emitEvent(EVENTS.vaultFsChanged, payload)
  }

  return { handlers, externalEdit }
}
