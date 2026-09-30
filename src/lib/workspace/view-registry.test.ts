import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ViewComponent } from './view-registry'
import {
  registerView,
  getView,
  resolveView,
  loadView,
  UNKNOWN_VIEW_KIND,
  __resetViewsForTests,
} from './view-registry'
import UnknownView from '$lib/components/workspace/UnknownView.svelte'

const FakeView = (() => {}) as unknown as ViewComponent

beforeEach(() => {
  __resetViewsForTests()
})

describe('view registry', () => {
  it('ships only the fallback view — nothing for notes yet', () => {
    expect(getView(UNKNOWN_VIEW_KIND)).toBeDefined()
    expect(getView('note')).toBeUndefined()
  })

  it('resolves an unregistered kind to the fallback', () => {
    expect(resolveView('note').kind).toBe(UNKNOWN_VIEW_KIND)
    expect(resolveView('view:graph').kind).toBe(UNKNOWN_VIEW_KIND)
  })

  it('loads the fallback component for an unknown kind', async () => {
    expect(await loadView('note')).toBe(UnknownView)
  })

  it('registers, resolves and lazily loads a view once', async () => {
    const component = vi.fn(async () => ({ default: FakeView }))
    registerView({ kind: 'note', component, titleKey: 'x' })
    expect(component).not.toHaveBeenCalled()
    expect(resolveView('note').titleKey).toBe('x')

    expect(await loadView('note')).toBe(FakeView)
    expect(await loadView('note')).toBe(FakeView)
    expect(component).toHaveBeenCalledTimes(1)
  })

  it('keeps the first registration for a kind', () => {
    registerView({
      kind: 'a',
      component: async () => ({ default: FakeView }),
      titleKey: 'first',
    })
    registerView({
      kind: 'a',
      component: async () => ({ default: FakeView }),
      titleKey: 'second',
    })
    expect(getView('a')?.titleKey).toBe('first')
  })

  it('unregisters, falling back again', () => {
    const unregister = registerView({
      kind: 'a',
      component: async () => ({ default: FakeView }),
    })
    unregister()
    expect(getView('a')).toBeUndefined()
    expect(resolveView('a').kind).toBe(UNKNOWN_VIEW_KIND)
  })

  it('falls back when a view fails to load, and retries next time', async () => {
    const component = vi
      .fn<() => Promise<{ default: ViewComponent }>>()
      .mockRejectedValueOnce(new Error('chunk missing'))
      .mockResolvedValueOnce({ default: FakeView })
    registerView({ kind: 'flaky', component })

    expect(await loadView('flaky')).toBe(UnknownView)
    expect(await loadView('flaky')).toBe(FakeView)
    expect(component).toHaveBeenCalledTimes(2)
  })
})
