import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockIPC } from '@tauri-apps/api/mocks'
import type { PersistedAppState } from '$lib/tauri-bindings'
import {
  initTabs,
  openTab,
  closeTab,
  closeOtherTabs,
  activateTab,
  nextTab,
  prevTab,
  moveTab,
  pinTab,
  unpinTab,
  togglePinTab,
  keepTab,
  setTabDirty,
  setTabTitle,
  getActiveTab,
  getGroupTabs,
  getGroups,
  getTab,
  getTabCount,
  hasClosedTabs,
  reopenClosedTab,
  snapshotTabs,
  __resetTabsForTests,
} from './tabs.svelte'
import {
  __resetAppStateForTests,
  getAppState,
  initAppState,
  persistAppStateNow,
} from '$lib/stores/app-state.svelte'
import {
  defaultAppState,
  sanitizeAppState,
  MAX_OPEN_TABS,
  MAX_TAB_TITLE_LEN,
} from '$lib/stores/app-state-schema'
import {
  confirmAccept,
  confirmCancel,
  getConfirmRequest,
  __resetConfirmForTests,
} from '$lib/stores/confirm.svelte'
import {
  getHasUnsavedChanges,
  setHasUnsavedChanges,
  __resetDirtyForTests,
} from '$lib/stores/dirty.svelte'

function state(overrides: Partial<PersistedAppState> = {}): PersistedAppState {
  return { ...defaultAppState(), ...overrides }
}

function note(name: string) {
  return { kind: 'note', uri: `ostralith://note/${name}.md`, title: name }
}

/** Opens tabs a, b, c… and returns their ids. */
function openMany(...names: string[]): string[] {
  return names.map((n) => openTab(note(n))!)
}

function titles(): string[] {
  return getGroupTabs().map((t) => t.title)
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  vi.useRealTimers()
  __resetAppStateForTests()
  __resetConfirmForTests()
  __resetDirtyForTests()
  __resetTabsForTests()
  initTabs(state())
})

describe('openTab', () => {
  it('opens and activates a tab', () => {
    const id = openTab(note('a'))
    expect(id).toBeTruthy()
    expect(getActiveTab()?.id).toBe(id)
    expect(getActiveTab()).toMatchObject({
      kind: 'note',
      title: 'a',
      dirty: false,
      pinned: false,
      preview: false,
    })
  })

  it('focuses the existing tab for the same URI instead of duplicating', () => {
    const [a] = openMany('a', 'b')
    expect(openTab(note('a'))).toBe(a)
    expect(getTabCount()).toBe(2)
    expect(getActiveTab()?.id).toBe(a)
  })

  it('inserts new tabs right after the active tab', () => {
    const [a] = openMany('a', 'b')
    activateTab(a!)
    openTab(note('c'))
    expect(titles()).toEqual(['a', 'c', 'b'])
  })

  it('does not activate a background tab', () => {
    const [a] = openMany('a')
    openTab(note('b'), { background: true })
    expect(getActiveTab()?.id).toBe(a)
    expect(getTabCount()).toBe(2)
  })

  it('activates a background tab when nothing else is open', () => {
    const id = openTab(note('a'), { background: true })
    expect(getActiveTab()?.id).toBe(id)
  })

  it('replaces the current preview tab with the next preview', () => {
    openMany('a')
    const p1 = openTab(note('p1'), { preview: true })
    openTab(note('p2'), { preview: true })
    expect(titles()).toEqual(['a', 'p2'])
    expect(getTab(p1!)).toBeUndefined()
    expect(getActiveTab()?.preview).toBe(true)
  })

  it('keeps a preview tab once it is dirty, kept, or reopened normally', () => {
    const p1 = openTab(note('p1'), { preview: true })!
    setTabDirty(p1, true)
    openTab(note('p2'), { preview: true })
    expect(titles()).toEqual(['p1', 'p2'])

    const p2 = getActiveTab()!.id
    keepTab(p2)
    openTab(note('p3'), { preview: true })
    expect(titles()).toEqual(['p1', 'p2', 'p3'])

    openTab(note('p3'))
    expect(getActiveTab()?.preview).toBe(false)
  })

  it('refuses a URI too long to persist', () => {
    expect(
      openTab({ kind: 'note', uri: 'x'.repeat(5000), title: 'x' }),
    ).toBeNull()
    expect(openTab({ kind: '', uri: 'u', title: 'x' })).toBeNull()
    expect(getTabCount()).toBe(0)
  })

  it(`caps the strip at ${MAX_OPEN_TABS} tabs`, () => {
    for (let i = 0; i < MAX_OPEN_TABS; i++) openTab(note(`n${i}`))
    expect(openTab(note('overflow'))).toBeNull()
    expect(getTabCount()).toBe(MAX_OPEN_TABS)
  })

  it('truncates an over-long title by whole characters', () => {
    const id = openTab({
      kind: 'note',
      uri: 'ostralith://note/long.md',
      title: 'é'.repeat(MAX_TAB_TITLE_LEN),
    })!
    const title = getTab(id)!.title
    expect(new TextEncoder().encode(title).length).toBeLessThanOrEqual(
      MAX_TAB_TITLE_LEN,
    )
    expect(title).toBe('é'.repeat(MAX_TAB_TITLE_LEN / 2))
  })
})

describe('closeTab', () => {
  it('activates the right-hand neighbour when closing the active tab', async () => {
    const [a, b] = openMany('a', 'b', 'c')
    activateTab(a!)
    // Opening after activation put nothing new in; b sits right of a.
    await closeTab(a!)
    expect(getActiveTab()?.id).toBe(b)
  })

  it('falls back to the left-hand neighbour when closing the last tab', async () => {
    const [, b, c] = openMany('a', 'b', 'c')
    expect(getActiveTab()?.id).toBe(c)
    await closeTab(c!)
    expect(getActiveTab()?.id).toBe(b)
  })

  it('leaves the active tab alone when closing another', async () => {
    const [a, , c] = openMany('a', 'b', 'c')
    await closeTab(a!)
    expect(getActiveTab()?.id).toBe(c)
    expect(titles()).toEqual(['b', 'c'])
  })

  it('leaves no active tab after closing the only one', async () => {
    const [a] = openMany('a')
    await closeTab(a!)
    expect(getActiveTab()).toBeUndefined()
    expect(getGroups()[0]!.activeTabId).toBeNull()
  })

  it('returns false for an unknown id', async () => {
    expect(await closeTab('nope')).toBe(false)
  })

  it('asks before closing a dirty tab and keeps it on cancel', async () => {
    const [a] = openMany('a')
    setTabDirty(a!, true)
    const pending = closeTab(a!)
    await flushMicrotasks()
    expect(getConfirmRequest()?.titleKey).toBe('workspace.closeDirty.title')
    expect(getConfirmRequest()?.titleOptions).toEqual({ title: 'a' })
    confirmCancel()
    expect(await pending).toBe(false)
    expect(getTab(a!)).toBeDefined()
  })

  it('closes a dirty tab once confirmed', async () => {
    const [a] = openMany('a')
    setTabDirty(a!, true)
    const pending = closeTab(a!)
    await flushMicrotasks()
    confirmAccept()
    expect(await pending).toBe(true)
    expect(getTab(a!)).toBeUndefined()
  })

  it('skips the prompt when forced', async () => {
    const [a] = openMany('a')
    setTabDirty(a!, true)
    expect(await closeTab(a!, { force: true })).toBe(true)
    expect(getConfirmRequest()).toBeNull()
  })

  it('reopens closed tabs most-recent first', async () => {
    const [a, b] = openMany('a', 'b')
    expect(hasClosedTabs()).toBe(false)
    await closeTab(a!)
    await closeTab(b!)
    reopenClosedTab()
    expect(getActiveTab()?.title).toBe('b')
    reopenClosedTab()
    expect(getActiveTab()?.title).toBe('a')
    expect(reopenClosedTab()).toBeNull()
  })
})

describe('closeOtherTabs', () => {
  it('closes unpinned tabs other than the given one, keeping pins', async () => {
    const [a, b, c, d] = openMany('a', 'b', 'c', 'd')
    pinTab(a!)
    expect(await closeOtherTabs(c!)).toBe(2)
    expect(titles()).toEqual(['a', 'c'])
    expect(getTab(b!)).toBeUndefined()
    expect(getTab(d!)).toBeUndefined()
    expect(getActiveTab()?.id).toBe(c)
  })

  it('keeps a dirty tab whose prompt is declined', async () => {
    const [a, b, c] = openMany('a', 'b', 'c')
    setTabDirty(b!, true)
    const pending = closeOtherTabs(a!)
    // a is not a target; b prompts, c waits behind it.
    await flushMicrotasks()
    confirmCancel()
    expect(await pending).toBe(1)
    expect(getTab(b!)).toBeDefined()
    expect(getTab(c!)).toBeUndefined()
  })
})

describe('navigation', () => {
  it('cycles forwards and backwards with wrap-around', () => {
    const [a, b, c] = openMany('a', 'b', 'c')
    expect(getActiveTab()?.id).toBe(c)
    nextTab()
    expect(getActiveTab()?.id).toBe(a)
    prevTab()
    expect(getActiveTab()?.id).toBe(c)
    prevTab()
    expect(getActiveTab()?.id).toBe(b)
  })

  it('is a no-op with no tabs', () => {
    nextTab()
    prevTab()
    expect(getActiveTab()).toBeUndefined()
  })

  it('ignores activating an unknown id', () => {
    const [a] = openMany('a')
    activateTab('nope')
    expect(getActiveTab()?.id).toBe(a)
  })
})

describe('moveTab and pinning', () => {
  it('reorders tabs', () => {
    openMany('a', 'b', 'c')
    moveTab(0, 2)
    expect(titles()).toEqual(['b', 'c', 'a'])
    moveTab(2, 0)
    expect(titles()).toEqual(['a', 'b', 'c'])
  })

  it('ignores an out-of-range source index', () => {
    openMany('a', 'b')
    moveTab(5, 0)
    expect(titles()).toEqual(['a', 'b'])
  })

  it('sorts pinned tabs first, in pin order', () => {
    const [, b, , d] = openMany('a', 'b', 'c', 'd')
    pinTab(d!)
    pinTab(b!)
    expect(titles()).toEqual(['d', 'b', 'a', 'c'])
    expect(getTab(d!)?.pinned).toBe(true)
  })

  it('unpinning moves a tab to the start of the unpinned block', () => {
    const [a, b] = openMany('a', 'b', 'c')
    pinTab(a!)
    pinTab(b!)
    unpinTab(a!)
    expect(titles()).toEqual(['b', 'a', 'c'])
    togglePinTab(a!)
    expect(titles()).toEqual(['b', 'a', 'c'])
    expect(getTab(a!)?.pinned).toBe(true)
  })

  it('clamps moves so pinned and unpinned tabs never interleave', () => {
    const [a] = openMany('a', 'b', 'c')
    pinTab(a!)
    moveTab(0, 2)
    expect(titles()).toEqual(['a', 'b', 'c'])
    moveTab(2, 0)
    expect(titles()).toEqual(['a', 'c', 'b'])
  })

  it('opens a new unpinned tab after the pinned block', () => {
    const [a] = openMany('a', 'b')
    pinTab(a!)
    activateTab(a!)
    openTab(note('c'))
    expect(titles()).toEqual(['a', 'c', 'b'])
  })

  it('opens a pinned tab at the end of the pinned block', () => {
    const [a] = openMany('a', 'b')
    pinTab(a!)
    openTab(note('p'), { pinned: true })
    expect(titles()).toEqual(['a', 'p', 'b'])
  })
})

describe('dirty tracking', () => {
  it('feeds the quit gate while any tab is dirty', () => {
    const [a, b] = openMany('a', 'b')
    setTabDirty(a!, true)
    setTabDirty(b!, true)
    expect(getHasUnsavedChanges()).toBe(true)
    setTabDirty(a!, false)
    expect(getHasUnsavedChanges()).toBe(true)
    setTabDirty(b!, false)
    expect(getHasUnsavedChanges()).toBe(false)
  })

  it('clears when the dirty tab is closed', async () => {
    const [a] = openMany('a')
    setTabDirty(a!, true)
    await closeTab(a!, { force: true })
    expect(getHasUnsavedChanges()).toBe(false)
  })

  it('is not cleared by resetting the manual flag', () => {
    const [a] = openMany('a')
    setTabDirty(a!, true)
    setHasUnsavedChanges(false)
    expect(getHasUnsavedChanges()).toBe(true)
  })

  it('mirrors the combined flag to the backend', () => {
    const calls: unknown[] = []
    mockIPC((cmd, args) => {
      if (cmd === 'set_has_unsaved_changes') calls.push(args)
    })
    const [a] = openMany('a')
    setTabDirty(a!, true)
    setTabDirty(a!, false)
    expect(calls).toEqual([{ dirty: true }, { dirty: false }])
  })
})

describe('setTabTitle', () => {
  it('renames a tab', () => {
    const [a] = openMany('a')
    setTabTitle(a!, 'Renamed')
    expect(getTab(a!)?.title).toBe('Renamed')
    expect(getAppState().openTabs[0]?.title).toBe('Renamed')
  })
})

describe('persistence', () => {
  it('mirrors the strip into app state without the dirty flag', () => {
    const [a, b] = openMany('a', 'b')
    pinTab(b!)
    setTabDirty(a!, true)
    const snap = snapshotTabs()
    expect(snap.activeTabId).toBe(b)
    expect(snap.openTabs).toEqual([
      {
        id: b,
        kind: 'note',
        uri: 'ostralith://note/b.md',
        title: 'b',
        pinned: true,
      },
      {
        id: a,
        kind: 'note',
        uri: 'ostralith://note/a.md',
        title: 'a',
        pinned: false,
      },
    ])
    expect(getAppState().openTabs).toEqual(snap.openTabs)
    expect(getAppState().activeTabId).toBe(b)
  })

  it('writes through the debounced app-state save, drained by flush', async () => {
    vi.useFakeTimers()
    const saves: PersistedAppState[] = []
    mockIPC((cmd, args) => {
      if (cmd === 'load_app_state') return defaultAppState()
      if (cmd === 'save_app_state') {
        saves.push((args as { appState: PersistedAppState }).appState)
        return null
      }
    })
    __resetTabsForTests()
    const loaded = await initAppState()
    initTabs(loaded)

    openMany('a', 'b')
    expect(saves).toHaveLength(0)
    await persistAppStateNow()
    expect(saves).toHaveLength(1)
    expect(saves[0]!.openTabs.map((t) => t.title)).toEqual(['a', 'b'])
    expect(saves[0]!.activeTabId).toBe(getActiveTab()?.id)
    expect(JSON.stringify(saves[0])).not.toContain('dirty')
  })

  it('does not touch app state before initTabs has run', () => {
    __resetTabsForTests()
    openTab(note('early'))
    expect(getAppState().openTabs).toEqual([])
  })
})

describe('initTabs', () => {
  it('restores tabs, pins first, and the active tab', () => {
    __resetTabsForTests()
    initTabs(
      state({
        openTabs: [
          { id: 't1', kind: 'note', uri: 'u1', title: 'One', pinned: false },
          { id: 't2', kind: 'note', uri: 'u2', title: 'Two', pinned: true },
          {
            id: 't3',
            kind: 'view:x',
            uri: 'u3',
            title: 'Three',
            pinned: false,
          },
        ],
        activeTabId: 't3',
      }),
    )
    expect(titles()).toEqual(['Two', 'One', 'Three'])
    expect(getActiveTab()?.id).toBe('t3')
    expect(getGroupTabs().every((t) => !t.dirty && !t.preview)).toBe(true)
  })

  it('falls back to the first tab when the active id is missing', () => {
    __resetTabsForTests()
    initTabs(
      state({
        openTabs: [
          { id: 't1', kind: 'note', uri: 'u1', title: 'One', pinned: false },
        ],
        activeTabId: null,
      }),
    )
    expect(getActiveTab()?.id).toBe('t1')
  })

  it('drops duplicate URIs and survives sanitised garbage', () => {
    __resetTabsForTests()
    const sanitized = sanitizeAppState({
      openTabs: [
        { id: 't1', kind: 'note', uri: 'u1', title: 'One', pinned: false },
        { id: 't2', kind: 'note', uri: 'u1', title: 'Dup', pinned: false },
        { id: 't3', kind: 42, uri: 'u3', title: 'Bad', pinned: false },
        'nonsense',
        { id: 't1', kind: 'note', uri: 'u9', title: 'Same id', pinned: false },
      ],
      activeTabId: 'ghost',
    })
    initTabs(sanitized)
    expect(titles()).toEqual(['One'])
    expect(getActiveTab()?.id).toBe('t1')
  })

  it('keeps tabs opened before init (early deep link) and focuses them', () => {
    __resetTabsForTests()
    const early = openTab(note('from-link'))
    initTabs(
      state({
        openTabs: [
          { id: 't1', kind: 'note', uri: 'u1', title: 'One', pinned: false },
        ],
        activeTabId: 't1',
      }),
    )
    expect(titles()).toEqual(['One', 'from-link'])
    expect(getActiveTab()?.id).toBe(early)
    expect(getAppState().openTabs).toHaveLength(2)
  })

  it('focuses the restored tab when an early deep link duplicated it', () => {
    __resetTabsForTests()
    openTab({ kind: 'note', uri: 'u2', title: 'Two (link)' })
    initTabs(
      state({
        openTabs: [
          { id: 't1', kind: 'note', uri: 'u1', title: 'One', pinned: false },
          { id: 't2', kind: 'note', uri: 'u2', title: 'Two', pinned: false },
        ],
        activeTabId: 't1',
      }),
    )
    expect(titles()).toEqual(['One', 'Two'])
    expect(getActiveTab()?.id).toBe('t2')
  })

  it('generates ids that do not collide with restored ones', () => {
    __resetTabsForTests()
    initTabs(
      state({
        openTabs: [
          { id: 't1', kind: 'note', uri: 'u1', title: 'One', pinned: false },
        ],
      }),
    )
    const id = openTab(note('new'))
    expect(id).not.toBe('t1')
    expect(getTabCount()).toBe(2)
  })
})
