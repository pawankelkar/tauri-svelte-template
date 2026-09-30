import type { Component } from 'svelte'
import { SvelteMap } from 'svelte/reactivity'
import { logger } from '$lib/logger'
import type { Tab } from './tabs.svelte'

/** Props every tab view receives. */
export interface ViewProps {
  tab: Tab
  groupId: string
}

export type ViewComponent = Component<ViewProps>

export interface ViewDefinition {
  /** Matched exactly against `Tab.kind`. */
  kind: string
  /**
   * Lazy loader, typically `() => import('./MyView.svelte')`, so a view's
   * code is only fetched the first time a tab of its kind is shown.
   */
  component: () => Promise<{ default: ViewComponent }>
  /** i18n key for a generic title, when a tab has none of its own. */
  titleKey?: string
  icon?: Component
}

/**
 * Shown for any tab whose kind has no registered view — a restored tab from
 * a newer build, or a kind (like `note`) whose view ships in a later phase.
 */
export const UNKNOWN_VIEW_KIND = 'unknown'

const UNKNOWN_VIEW: ViewDefinition = {
  kind: UNKNOWN_VIEW_KIND,
  component: () => import('$lib/components/workspace/UnknownView.svelte'),
  titleKey: 'workspace.unknownView.title',
}

// Reactive so a view registered after a tab is already on screen (a plugin
// loading late) replaces the fallback without a reload.
const _views = new SvelteMap<string, ViewDefinition>([
  [UNKNOWN_VIEW_KIND, UNKNOWN_VIEW],
])
const _loaded = new Map<ViewDefinition, Promise<ViewComponent>>()

/**
 * Registers a view for a tab kind and returns its unregister function. A
 * second registration for the same kind is ignored (first wins), matching
 * the command registry.
 */
export function registerView(definition: ViewDefinition): () => void {
  if (_views.has(definition.kind)) {
    logger.warn(`View "${definition.kind}" is already registered, skipping`)
    return () => {}
  }
  _views.set(definition.kind, definition)
  return () => {
    if (_views.get(definition.kind) !== definition) return
    _views.delete(definition.kind)
    _loaded.delete(definition)
  }
}

export function getView(kind: string): ViewDefinition | undefined {
  return _views.get(kind)
}

/** The view for `kind`, or the "not available" fallback. */
export function resolveView(kind: string): ViewDefinition {
  return _views.get(kind) ?? _views.get(UNKNOWN_VIEW_KIND) ?? UNKNOWN_VIEW
}

/**
 * Loads the component for `kind` (or the fallback). The promise is cached
 * per definition, so switching between tabs of one kind never re-imports;
 * a failed import is evicted so the next attempt retries instead of
 * replaying the error forever. A view that fails to load resolves to the
 * fallback rather than rejecting, so a broken plugin view cannot blank the
 * editor.
 */
export function loadView(kind: string): Promise<ViewComponent> {
  const definition = resolveView(kind)
  const cached = _loaded.get(definition)
  if (cached) return cached

  const promise = definition.component().then(
    (module) => module.default,
    (error: unknown) => {
      _loaded.delete(definition)
      if (definition === UNKNOWN_VIEW) throw error
      logger.error(`Loading view "${kind}" failed`, error)
      return loadView(UNKNOWN_VIEW_KIND)
    },
  )
  _loaded.set(definition, promise)
  return promise
}

export function __resetViewsForTests(): void {
  _views.clear()
  _views.set(UNKNOWN_VIEW_KIND, UNKNOWN_VIEW)
  _loaded.clear()
}
