import { describe, it, expect, afterEach } from 'vitest'
import { mount, unmount, createRawSnippet } from 'svelte'
import TitleBarShell from './TitleBarShell.svelte'
import LinuxTitleBar from './LinuxTitleBar.svelte'

/**
 * The three platform titlebars share their chrome through TitleBarShell.
 * These tests pin the parts that are invisible until they break: the window
 * stops dragging, or the title drifts as the side clusters change width.
 *
 * Only the shell and the Linux variant are mounted here — the macOS and
 * Windows variants call getCurrentWindow() at module scope, which needs a real
 * Tauri host.
 */

function text(html: string) {
  return createRawSnippet(() => ({ render: () => html }))
}

let target: HTMLElement | null = null
let component: Record<string, unknown> | null = null

function render(Component: typeof TitleBarShell, props: object) {
  target = document.createElement('div')
  document.body.appendChild(target)
  component = mount(Component, { target, props }) as Record<string, unknown>
  return target
}

afterEach(() => {
  if (component) void unmount(component)
  target?.remove()
  component = null
  target = null
})

describe('TitleBarShell', () => {
  it('marks only the bar as a drag region, never the title overlay', () => {
    // The overlay is pointer-events-none, so clicks fall through to the bar
    // and dragging works without marking it. Marking it too would re-cover
    // the leading cluster's no-drag rect in the native (paint-order) region
    // computation, making fast double-clicks on the left buttons maximize.
    const el = render(TitleBarShell, { title: 'Anything' })
    expect(el.querySelectorAll('[data-tauri-drag-region]')).toHaveLength(1)
    const overlay = el.querySelector('.absolute')
    expect(overlay?.hasAttribute('data-tauri-drag-region')).toBe(false)
  })

  it('centres the title independently of the side clusters', () => {
    const el = render(TitleBarShell, {
      title: 'Centred',
      leading: text('<span>a very wide leading cluster</span>'),
      trailing: text('<span>x</span>'),
    })

    const overlay = el.querySelector('.absolute')
    expect(overlay?.textContent).toContain('Centred')
    // Absolute + pointer-events-none is what keeps it still and keeps clicks
    // reaching the drag region underneath.
    expect(overlay?.className).toContain('inset-0')
    expect(overlay?.className).toContain('pointer-events-none')
  })

  it('falls back to the default title when none is given', () => {
    const el = render(TitleBarShell, {})
    expect(el.textContent?.trim()).not.toBe('')
  })

  it('renders the leading cluster before the trailing one', () => {
    const el = render(TitleBarShell, {
      title: 'Order',
      leading: text('<span data-testid="lead">lead</span>'),
      trailing: text('<span data-testid="trail">trail</span>'),
    })

    const lead = el.querySelector('[data-testid="lead"]')!
    const trail = el.querySelector('[data-testid="trail"]')!
    expect(
      lead.compareDocumentPosition(trail) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })
})

describe('LinuxTitleBar', () => {
  it('places both action slots into the shared shell', () => {
    const el = render(LinuxTitleBar as unknown as typeof TitleBarShell, {
      title: 'Linux',
      leftActions: text('<span data-testid="left">L</span>'),
      rightActions: text('<span data-testid="right">R</span>'),
    })

    expect(el.querySelector('[data-testid="left"]')).not.toBeNull()
    expect(el.querySelector('[data-testid="right"]')).not.toBeNull()
    // Draggable surface: the bar itself, nothing else.
    expect(el.querySelectorAll('[data-tauri-drag-region=""]')).toHaveLength(1)
    // The action clusters opt out of dragging so that a fast double-click
    // beside a titlebar button cannot read as "maximize the window".
    expect(
      el.querySelectorAll('[data-tauri-drag-region="false"]'),
    ).toHaveLength(2)
    expect(el.textContent).toContain('Linux')
  })
})
