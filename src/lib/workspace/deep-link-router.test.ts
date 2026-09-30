import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('$lib/stores/toast', () => ({
  toast: { info: vi.fn(), warning: vi.fn() },
}))

import { toast } from '$lib/stores/toast'
import i18n from '$lib/i18n/config'
import { routeDeepLink } from './deep-link-router'
import {
  getActiveTab,
  getTabCount,
  initTabs,
  __resetTabsForTests,
} from './tabs.svelte'
import { defaultAppState } from '$lib/stores/app-state-schema'
import {
  getActivePreferencesPane,
  isPreferencesDialogOpen,
  __resetPreferencesDialogStateForTests,
} from '$lib/commands/preferences-dialog-state.svelte'

beforeEach(() => {
  vi.clearAllMocks()
  __resetTabsForTests()
  __resetPreferencesDialogStateForTests()
  initTabs(defaultAppState())
})

describe('routeDeepLink', () => {
  it('opens a note tab titled by its file name', () => {
    routeDeepLink('ostralith://note/Projects/Q3%20Plan.md#Goals')
    expect(getActiveTab()).toMatchObject({
      kind: 'note',
      uri: 'ostralith://note/Projects/Q3%20Plan.md',
      title: 'Q3 Plan',
    })
  })

  it('reuses the tab for another spelling of the same note', () => {
    routeDeepLink('ostralith://note/a.md')
    routeDeepLink('OSTRALITH://NOTE/a.md#Heading')
    expect(getTabCount()).toBe(1)
  })

  it('opens settings views in the preferences dialog', () => {
    routeDeepLink('ostralith://view/settings.shortcuts')
    expect(isPreferencesDialogOpen()).toBe(true)
    expect(getActivePreferencesPane()).toBe('shortcuts')
    expect(getTabCount()).toBe(0)
  })

  it('reaches the Privacy & Network pane', () => {
    routeDeepLink('ostralith://view/settings.privacy')
    expect(isPreferencesDialogOpen()).toBe(true)
    expect(getActivePreferencesPane()).toBe('privacy')
    expect(getTabCount()).toBe(0)
  })

  it('does not treat inherited object keys as panes', () => {
    routeDeepLink('ostralith://view/settings.toString')
    expect(isPreferencesDialogOpen()).toBe(false)
  })

  it('opens plain settings on the current pane', () => {
    routeDeepLink('ostralith://view/settings')
    expect(isPreferencesDialogOpen()).toBe(true)
    expect(getActivePreferencesPane()).toBe('general')
  })

  it('opens other views as a tab (rendered by the fallback until registered)', () => {
    routeDeepLink('ostralith://view/graph')
    expect(getActiveTab()).toMatchObject({
      kind: 'view:graph',
      uri: 'ostralith://view/graph',
    })
  })

  it('treats an unknown settings pane as an ordinary view', () => {
    routeDeepLink('ostralith://view/settings.nope')
    expect(isPreferencesDialogOpen()).toBe(false)
    expect(getActiveTab()?.kind).toBe('view:settings.nope')
  })

  it('explains that search is not available yet', () => {
    routeDeepLink('ostralith://search?q=x')
    expect(toast.info).toHaveBeenCalledWith(
      i18n.t('workspace.deepLink.searchUnavailable'),
    )
    expect(getTabCount()).toBe(0)
  })

  it('warns about an invalid link', () => {
    routeDeepLink('ostralith://note/../etc/passwd')
    expect(toast.warning).toHaveBeenCalledWith(
      i18n.t('workspace.deepLink.invalid'),
      { description: 'ostralith://note/../etc/passwd' },
    )
    expect(getTabCount()).toBe(0)
  })
})
