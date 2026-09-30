import { describe, it, expect, vi } from 'vitest'
import {
  EVENTS,
  type Backlink,
  type BackupStatus,
  type Heading,
  type IndexStatus,
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
import { createFakeVault } from './fake-vault'

function setup(open = true) {
  const emitEvent = vi.fn()
  const scheduled: (() => void)[] = []
  const { handlers, externalEdit } = createFakeVault({
    emitEvent,
    now: () => 1_790_000_000_000,
    schedule: (fn) => scheduled.push(fn),
  })
  const call = <T>(cmd: string, args: Record<string, unknown> = {}): T => {
    const handler = handlers[cmd]
    if (!handler) throw new Error(`no handler for ${cmd}`)
    return handler(args) as T
  }
  if (open) call('vault_open', { path: '/Users/me/Notes' })
  emitEvent.mockClear()
  return { call, emitEvent, scheduled, externalEdit }
}

const highlighted = (parts: TextPart[]) =>
  parts
    .filter((p) => p.highlight)
    .map((p) => p.text)
    .join('')

const joined = (parts: TextPart[]) => parts.map((p) => p.text).join('')

describe('vault lifecycle', () => {
  it('starts with no vault and rejects vault commands with noVault', () => {
    const { call } = setup(false)
    expect(call('vault_list')).toEqual([])
    expect(call('vault_current')).toBeNull()
    expect(call('index_status')).toEqual({
      indexing: false,
      done: 0,
      total: 0,
      noteCount: 0,
    })
    expect(() => call('list_tree')).toThrow(
      expect.objectContaining({ kind: 'noVault' }),
    )
  })

  it('opens, lists, closes, reopens by id and forgets vaults', () => {
    const { call, emitEvent } = setup(false)
    const info = call<VaultInfo>('vault_open', { path: '/Users/me/Notes/' })
    expect(info).toMatchObject({
      name: 'Notes',
      path: '/Users/me/Notes',
      encryption: 'none',
    })
    expect(emitEvent).toHaveBeenCalledWith(EVENTS.vaultCurrentChanged, info)
    expect(call('vault_current')).toEqual(info)

    const created = call<VaultInfo>('vault_create', {
      parentDir: '/Users/me',
      name: 'Work',
      encryption: 'keychain',
    })
    expect(created).toMatchObject({ path: '/Users/me/Work', name: 'Work' })
    expect(call<VaultInfo[]>('vault_list').map((v) => v.id)).toEqual([
      created.id,
      info.id,
    ])
    expect(() =>
      call('vault_create', {
        parentDir: '/Users/me',
        name: 'Work',
        encryption: 'none',
      }),
    ).toThrow(expect.objectContaining({ kind: 'alreadyExists' }))

    expect(call('vault_close')).toBeNull()
    expect(emitEvent).toHaveBeenLastCalledWith(EVENTS.vaultCurrentChanged, null)
    expect(call<VaultInfo>('vault_open_by_id', { id: info.id }).id).toBe(
      info.id,
    )
    expect(() => call('vault_open_by_id', { id: 'nope' })).toThrow(
      expect.objectContaining({ kind: 'notFound' }),
    )

    call('vault_forget', { id: info.id })
    expect(call('vault_current')).toBeNull()
    expect(call<VaultInfo[]>('vault_list').map((v) => v.id)).toEqual([
      created.id,
    ])
  })

  it('keeps each vault’s edits across a switch', () => {
    const { call } = setup()
    const first = call<VaultInfo>('vault_current')
    call('create_folder', { path: 'Scratch' })
    call('vault_create', {
      parentDir: '/tmp',
      name: 'Other',
      encryption: 'none',
    })
    const names = () => call<TreeNode[]>('list_tree').map((n) => n.name)
    expect(names()).not.toContain('Scratch')
    call('vault_open_by_id', { id: first.id })
    expect(names()).toContain('Scratch')
  })
})

describe('list_tree', () => {
  it('puts folders first, sorts naturally and hides dotfiles', () => {
    const { call } = setup()
    const tree = call<TreeNode[]>('list_tree')
    const names = tree.map((n) => n.name)
    expect(names.slice(0, 6)).toEqual([
      'Attachments',
      'Daily',
      'Meetings',
      'Projects',
      'Reading',
      // then notes
      'Getting Started.md',
    ])
    expect(names).not.toContain('.DS_Store')

    const reading = tree.find((n) => n.name === 'Reading')
    expect(reading?.children.map((n) => n.name)).toEqual([
      'Chapter 2.md',
      'Chapter 10.md',
    ])
    const projects = tree.find((n) => n.name === 'Projects')
    expect(projects?.children[0]).toMatchObject({
      kind: 'folder',
      path: 'Projects/Research',
    })
    const attachments = tree.find((n) => n.name === 'Attachments')
    expect(attachments?.children[0]).toMatchObject({
      kind: 'file',
      children: [],
    })
    expect(tree.find((n) => n.name === 'Welcome.md')?.kind).toBe('note')
  })
})

describe('read_note / write_note', () => {
  it('reads content, frontmatter, title and hash', () => {
    const { call } = setup()
    const note = call<Note>('read_note', { path: 'Welcome.md' })
    expect(note.title).toBe('Welcome to Ostralith')
    expect(note.frontmatter).toMatchObject({ tags: ['meta', 'start-here'] })
    expect(note.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(
      call<Note>('read_note', { path: 'Markdown Cheatsheet.md' }).frontmatter,
    ).toEqual({ tags: ['reference', 'howto'] })
    expect(call<Note>('read_note', { path: 'Ideas.md' }).frontmatter).toBeNull()
  })

  it('rejects missing notes and paths outside the vault', () => {
    const { call } = setup()
    expect(() => call('read_note', { path: 'Nope.md' })).toThrow(
      expect.objectContaining({ kind: 'notFound', what: 'Nope.md' }),
    )
    for (const path of ['../etc/passwd', '/abs.md', 'a/../../b.md']) {
      expect(() => call('read_note', { path })).toThrow(
        expect.objectContaining({ kind: 'pathOutsideVault' }),
      )
    }
  })

  it('writes with a matching hash and reports a conflict otherwise', () => {
    const { call } = setup()
    const note = call<Note>('read_note', { path: 'Ideas.md' })
    const res = call<WriteResult>('write_note', {
      path: 'Ideas.md',
      content: '# Ideas\n\nnew',
      expectedHash: note.hash,
    })
    expect(res.hash).not.toBe(note.hash)
    expect(call<Note>('read_note', { path: 'Ideas.md' }).content).toBe(
      '# Ideas\n\nnew',
    )
    expect(() =>
      call('write_note', {
        path: 'Ideas.md',
        content: 'stale',
        expectedHash: note.hash,
      }),
    ).toThrow(expect.objectContaining({ kind: 'conflict', path: 'Ideas.md' }))
    // No expected hash: last write wins.
    call('write_note', { path: 'Ideas.md', content: 'x', expectedHash: null })
    expect(call<Note>('read_note', { path: 'Ideas.md' }).content).toBe('x')
  })
})

describe('create_note / create_folder', () => {
  it('names new notes Untitled, Untitled 1, ...', () => {
    const { call } = setup()
    const a = call<NoteRef>('create_note', { folder: null, title: null })
    const b = call<NoteRef>('create_note', { folder: null, title: null })
    expect(a).toEqual({ path: 'Untitled.md', title: 'Untitled' })
    expect(b).toEqual({ path: 'Untitled 1.md', title: 'Untitled 1' })
  })

  it('creates a titled note inside a folder with a heading', () => {
    const { call } = setup()
    const ref = call<NoteRef>('create_note', {
      folder: 'Projects',
      title: 'Plan: Q4',
    })
    expect(ref).toEqual({ path: 'Projects/Plan Q4.md', title: 'Plan: Q4' })
    expect(call<Note>('read_note', { path: ref.path }).content).toBe(
      '# Plan: Q4\n\n',
    )
    expect(() => call('create_note', { folder: 'Nope', title: null })).toThrow(
      expect.objectContaining({ kind: 'notFound' }),
    )
  })

  it('creates nested folders and refuses duplicates', () => {
    const { call } = setup()
    call('create_folder', { path: 'A/B' })
    const a = call<TreeNode[]>('list_tree').find((n) => n.path === 'A')
    expect(a?.children.map((n) => n.path)).toEqual(['A/B'])
    expect(() => call('create_folder', { path: 'a' })).toThrow(
      expect.objectContaining({ kind: 'alreadyExists' }),
    )
  })
})

describe('rename_path / trash_path', () => {
  it('renames a note and rewrites inbound links, keeping heading and alias', () => {
    const { call } = setup()
    const res = call<RenameResult>('rename_path', {
      from: 'Projects/Research/Local-first Software.md',
      to: 'Projects/Research/Local-first.md',
    })
    // CRDT Reading List (heading), Chapter 2 (alias), Roadmap (plain).
    expect(res).toEqual({
      path: 'Projects/Research/Local-first.md',
      updatedLinks: 3,
      updatedFiles: 3,
    })
    const content = (path: string) => call<Note>('read_note', { path }).content
    expect(content('Projects/Research/CRDT Reading List.md')).toContain(
      '[[Local-first#Principles]]',
    )
    expect(content('Reading/Chapter 2.md')).toContain(
      '[[Local-first|LFS paper]]',
    )
    expect(() =>
      call('read_note', { path: 'Projects/Research/Local-first Software.md' }),
    ).toThrow(expect.objectContaining({ kind: 'notFound' }))
  })

  it('moves folders with their contents and keeps path-style links valid', () => {
    const { call } = setup()
    const res = call<RenameResult>('rename_path', {
      from: 'Projects',
      to: 'Archive/Projects',
    })
    expect(res.path).toBe('Archive/Projects')
    // Welcome and Daily/2026-09-29 link by full path; basename links need
    // no change.
    expect(res.updatedFiles).toBe(2)
    expect(call<Note>('read_note', { path: 'Welcome.md' }).content).toContain(
      '[[Archive/Projects/Ostralith Roadmap|the roadmap]]',
    )
    expect(
      call<Note>('read_note', {
        path: 'Archive/Projects/Research/CRDT Reading List.md',
      }).title,
    ).toBe('CRDT Reading List')
  })

  it('refuses to overwrite and moves trashed items out of the tree', () => {
    const { call } = setup()
    expect(() =>
      call('rename_path', { from: 'Ideas.md', to: 'Welcome.md' }),
    ).toThrow(expect.objectContaining({ kind: 'alreadyExists' }))

    call('trash_path', { path: 'Reading' })
    const names = call<TreeNode[]>('list_tree').map((n) => n.name)
    expect(names).not.toContain('Reading')
    expect(names).not.toContain('.trash')
    expect(() => call('trash_path', { path: 'Reading' })).toThrow(
      expect.objectContaining({ kind: 'notFound' }),
    )
  })
})

describe('links and outline', () => {
  it('finds backlinks with 0-based lines and trimmed context', () => {
    const { call } = setup()
    const links = call<Backlink[]>('get_backlinks', { path: 'Welcome.md' })
    // One entry per linking line: Getting Started links twice.
    expect(links.map((l) => l.sourcePath).sort()).toEqual([
      'Getting Started.md',
      'Getting Started.md',
      'Projects/Research/Local-first Software.md',
    ])
    const fromGettingStarted = links.find(
      (l) => l.sourcePath === 'Getting Started.md',
    )
    expect(fromGettingStarted).toMatchObject({ line: 2 })
    expect(fromGettingStarted?.context).toBe('Back to [[Welcome]].')
    // Links inside fenced code are not links.
    expect(
      call<Backlink[]>('get_backlinks', { path: 'Not a link either.md' }),
    ).toEqual([])
  })

  it('outlines ATX headings outside code fences, with unique slugs', () => {
    const { call } = setup(false)
    const headings = call<Heading[]>('get_outline', {
      content:
        '---\ntitle: x\n---\n# Top\n\n## Same\n```\n# not\n```\n## Same ##\n#nope',
    })
    expect(headings).toEqual([
      { level: 1, text: 'Top', line: 3, slug: 'top' },
      { level: 2, text: 'Same', line: 5, slug: 'same' },
      { level: 2, text: 'Same', line: 9, slug: 'same-1' },
    ])
  })

  it('resolves links by path, then basename, case-insensitively', () => {
    const { call } = setup()
    const resolve = (target: string) =>
      call<LinkTarget>('resolve_link', { fromPath: 'Welcome.md', target })
    expect(resolve('crdt reading list')).toMatchObject({
      path: 'Projects/Research/CRDT Reading List.md',
      exists: true,
    })
    expect(resolve('Daily/2026-09-29#Standup|standup')).toEqual({
      raw: 'Daily/2026-09-29#Standup|standup',
      path: 'Daily/2026-09-29.md',
      heading: 'Standup',
      exists: true,
    })
    expect(resolve('Nonexistent Note')).toMatchObject({
      path: 'Nonexistent Note.md',
      exists: false,
    })
    expect(resolve('#First steps')).toMatchObject({
      path: 'Welcome.md',
      heading: 'First steps',
    })
    expect(resolve('architecture.png')).toMatchObject({
      path: 'Attachments/architecture.png',
      exists: true,
    })
  })
})

describe('quick_open / search_fulltext', () => {
  it('lists recent notes for an empty query', () => {
    const { call } = setup()
    const items = call<QuickOpenItem[]>('quick_open', { query: '', limit: 3 })
    expect(items.map((i) => i.path)).toEqual([
      'Daily/2026-09-30.md',
      'Welcome.md',
      'Ideas.md',
    ])
  })

  it('fuzzy-matches with highlighted parts', () => {
    const { call } = setup()
    const [first] = call<QuickOpenItem[]>('quick_open', {
      query: 'crdt',
      limit: 5,
    })
    expect(first?.path).toBe('Projects/Research/CRDT Reading List.md')
    expect(highlighted(first?.titleParts ?? [])).toBe('CRDT')
    expect(joined(first?.pathParts ?? [])).toBe(first?.path)
    expect(
      call<QuickOpenItem[]>('quick_open', { query: 'zzzz', limit: 5 }),
    ).toEqual([])
  })

  it('searches title and body with a highlighted snippet', () => {
    const { call } = setup()
    const hits = call<SearchHit[]>('search_fulltext', {
      query: 'spinners',
      limit: 10,
    })
    expect(hits.map((h) => h.path)).toEqual([
      'Projects/Research/Local-first Software.md',
    ])
    expect(highlighted(hits[0]?.snippet ?? [])).toBe('spinners')
  })

  it('supports tag:, path: and quoted phrases', () => {
    const { call } = setup()
    const paths = (query: string) =>
      call<SearchHit[]>('search_fulltext', { query, limit: 20 })
        .map((h) => h.path)
        .sort()
    expect(paths('tag:research')).toEqual([
      'Projects/Research/CRDT Reading List.md',
      'Projects/Research/Local-first Software.md',
    ])
    expect(paths('path:daily standup')).toEqual([
      'Daily/2026-09-29.md',
      'Daily/2026-09-30.md',
    ])
    expect(paths('"source of truth"')).toEqual([
      'Meetings/Meeting Notes 2026-09-15.md',
    ])
    expect(paths('')).toEqual([])
  })
})

describe('index and db status', () => {
  it('reports counts and emits reindex progress', () => {
    const { call, emitEvent, scheduled } = setup()
    const idle = call<IndexStatus>('index_status')
    expect(idle).toMatchObject({ indexing: false, noteCount: 14 })

    call('reindex')
    expect(emitEvent).toHaveBeenLastCalledWith(
      EVENTS.indexStatus,
      expect.objectContaining({ indexing: true, done: 0 }),
    )
    while (scheduled.length) scheduled.shift()?.()
    expect(emitEvent).toHaveBeenLastCalledWith(EVENTS.indexStatus, idle)
  })

  it('describes the database', () => {
    const { call } = setup()
    expect(call('db_status')).toMatchObject({
      encryption: 'none',
      schemaVersion: 1,
      noteCount: 14,
      integrityOk: true,
    })
  })
})

describe('backups', () => {
  it('seeds history for an opened vault and snapshots changes', () => {
    const { call } = setup()
    const status = call<BackupStatus>('backup_status')
    expect(status).toMatchObject({
      initialized: true,
      changedFiles: 1,
      remote: null,
    })

    const snap = call<SnapshotInfo>('backup_now', { message: 'Save' })
    expect(snap).toMatchObject({ message: 'Save', filesChanged: 1 })
    expect(call('backup_now', { message: null })).toBeNull()
    expect(call<BackupStatus>('backup_status').lastSnapshot).toEqual(snap)
  })

  it('lists and restores a note’s history', () => {
    const { call } = setup()
    const path = 'Projects/Ostralith Roadmap.md'
    const history = call<SnapshotInfo[]>('note_history', { path, limit: 10 })
    expect(history).toHaveLength(2)
    const oldest = history[history.length - 1]
    const res = call<WriteResult>('note_restore', {
      path,
      snapshotId: oldest?.id,
    })
    const restored = call<Note>('read_note', { path })
    expect(restored.hash).toBe(res.hash)
    expect(restored.content).toContain('- [ ] Vault registry')
    // The pre-restore state was snapshotted first.
    expect(call<BackupStatus>('backup_status').lastSnapshot?.message).toBe(
      `Before restoring ${path}`,
    )
    expect(() => call('note_restore', { path, snapshotId: 'missing' })).toThrow(
      expect.objectContaining({ kind: 'notFound' }),
    )
  })

  it('needs backup_init for a created vault', () => {
    const { call } = setup(false)
    call('vault_create', { parentDir: '/tmp', name: 'New', encryption: 'none' })
    expect(call<BackupStatus>('backup_status').initialized).toBe(false)
    expect(() => call('backup_now', { message: null })).toThrow(
      expect.objectContaining({ kind: 'invalidInput' }),
    )
    expect(call<BackupStatus>('backup_init').initialized).toBe(true)
    expect(call<SnapshotInfo>('backup_now', { message: null })).not.toBeNull()
    expect(
      call<BackupStatus>('backup_set_remote', { url: 'git@example.com:me/n' })
        .remote,
    ).toBe('git@example.com:me/n')
  })
})

describe('externalEdit', () => {
  it('changes the file under the editor and emits vault:fs-changed', () => {
    const { call, emitEvent, externalEdit } = setup()
    const before = call<Note>('read_note', { path: 'Ideas.md' })
    externalEdit('Ideas.md', 'edited elsewhere')
    expect(emitEvent).toHaveBeenLastCalledWith(EVENTS.vaultFsChanged, {
      changes: [{ path: 'Ideas.md', kind: 'modified', oldPath: null }],
    })
    expect(() =>
      call('write_note', {
        path: 'Ideas.md',
        content: 'mine',
        expectedHash: before.hash,
      }),
    ).toThrow(expect.objectContaining({ kind: 'conflict' }))

    externalEdit('New.md', '# New')
    expect(emitEvent).toHaveBeenLastCalledWith(EVENTS.vaultFsChanged, {
      changes: [{ path: 'New.md', kind: 'created', oldPath: null }],
    })
    externalEdit('New.md', null)
    expect(emitEvent).toHaveBeenLastCalledWith(EVENTS.vaultFsChanged, {
      changes: [{ path: 'New.md', kind: 'removed', oldPath: null }],
    })
  })
})
