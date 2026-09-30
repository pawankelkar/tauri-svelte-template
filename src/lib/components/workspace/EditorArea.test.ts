import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, unmount, flushSync, tick } from 'svelte'
import EditorArea from './EditorArea.svelte'
import {
  getActiveTab,
  getGroupTabs,
  initTabs,
  openTab,
  pinTab,
  setTabDirty,
  __resetTabsForTests,
} from '$lib/workspace/tabs.svelte'
import { __resetViewsForTests } from '$lib/workspace/view-registry'
import { defaultAppState } from '$lib/stores/app-state-schema'
import i18n from '$lib/i18n/config'

let target: HTMLElement
let component: Record<string, unknown> | null = null

function note(name: string) {
  return { kind: 'note', uri: `ostralith://note/${name}.md`, title: name }
}

function render(): HTMLElement {
  component = mount(EditorArea, { target }) as Record<string, unknown>
  flushSync()
  return target
}

/** Lets the lazy view import settle and the DOM catch up. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 0))
    await tick()
  }
}

function tabs(): HTMLElement[] {
  return Array.from(target.querySelectorAll<HTMLElement>('[role="tab"]'))
}

beforeEach(() => {
  __resetTabsForTests()
  __resetViewsForTests()
  initTabs(defaultAppState())
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(() => {
  if (component) unmount(component)
  component = null
  target.remove()
})

describe('EditorArea', () => {
  it('shows the no-vault empty state when no tabs are open', () => {
    render()
    expect(target.textContent).toContain(i18n.t('workspace.empty.title'))
    expect(target.textContent).toContain(i18n.t('workspace.empty.createVault'))
    expect(target.textContent).toContain(i18n.t('workspace.empty.openVault'))
    expect(target.querySelector('[role="tablist"]')).toBeNull()
  })

  it('renders an accessible tab strip with the active tab selected', () => {
    openTab(note('a'))
    openTab(note('b'))
    render()
    expect(target.querySelector('[role="tablist"]')).not.toBeNull()
    const [a, b] = tabs()
    expect(a!.textContent).toContain('a')
    expect(b!.getAttribute('aria-selected')).toBe('true')
    expect(b!.tabIndex).toBe(0)
    expect(a!.getAttribute('aria-selected')).toBe('false')
    expect(a!.tabIndex).toBe(-1)
    const panel = target.querySelector('[role="tabpanel"]')!
    expect(panel.getAttribute('aria-labelledby')).toBe(b!.id)
    expect(b!.getAttribute('aria-controls')).toBe(panel.id)
  })

  it('renders the fallback view for a kind with no registered view', async () => {
    openTab(note('a'))
    render()
    await vi.waitFor(() =>
      expect(target.textContent).toContain(
        i18n.t('workspace.unknownView.title'),
      ),
    )
  })

  it('activates tabs on click and with arrow keys', () => {
    openTab(note('a'))
    openTab(note('b'))
    render()
    tabs()[0]!.click()
    flushSync()
    expect(getActiveTab()?.title).toBe('a')

    tabs()[0]!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    )
    flushSync()
    expect(getActiveTab()?.title).toBe('b')
    expect(document.activeElement).toBe(tabs()[1])

    tabs()[1]!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Home', bubbles: true }),
    )
    flushSync()
    expect(getActiveTab()?.title).toBe('a')
  })

  it('closes a tab with middle-click and with the close button', async () => {
    openTab(note('a'))
    openTab(note('b'))
    openTab(note('c'))
    render()
    const item = tabs()[0]!.parentElement!
    item.dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true }))
    await settle()
    expect(getGroupTabs().map((t) => t.title)).toEqual(['b', 'c'])

    const close = target.querySelector<HTMLButtonElement>(
      `[aria-label="${i18n.t('workspace.tabs.closeTab', { title: 'b' })}"]`,
    )!
    close.click()
    await settle()
    expect(getGroupTabs().map((t) => t.title)).toEqual(['c'])
  })

  it('shows dirty and pinned state', () => {
    const a = openTab(note('a'))!
    openTab(note('b'))
    pinTab(a)
    setTabDirty(a, true)
    render()
    const pinned = tabs()[0]!.parentElement!
    expect(pinned.textContent).toContain(i18n.t('workspace.tabs.unsaved'))
    expect(
      pinned.querySelector(
        `[aria-label="${i18n.t('workspace.tabs.unpinTab', { title: 'a' })}"]`,
      ),
    ).not.toBeNull()
  })
})
