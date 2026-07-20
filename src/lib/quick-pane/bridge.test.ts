import { describe, it, expect, vi, beforeEach } from 'vitest'

// `vi.hoisted` because vi.mock factories are lifted above the imports, so a
// plain top-level const would not exist yet when the factory runs.
const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }))
vi.mock('$lib/stores/toast', () => ({
  toast: { success: toastSuccess, error: vi.fn(), message: vi.fn() },
}))

import { applyQuickPaneEntry } from './bridge'
import { getLastQuickPaneEntry } from '$lib/stores/ui.svelte'
import { resetAllStores } from '../../test/reset-stores'

beforeEach(() => {
  resetAllStores()
  toastSuccess.mockClear()
})

describe('applyQuickPaneEntry', () => {
  it('records the submitted text in app state', () => {
    applyQuickPaneEntry('buy milk')

    expect(getLastQuickPaneEntry()).toBe('buy milk')
    expect(toastSuccess).toHaveBeenCalledOnce()
  })

  it('trims surrounding whitespace', () => {
    applyQuickPaneEntry('   padded   ')

    expect(getLastQuickPaneEntry()).toBe('padded')
  })

  it('ignores an empty submission', () => {
    // The pane dismisses on a bare Enter, which must not overwrite whatever
    // the user last actually entered.
    applyQuickPaneEntry('kept')
    applyQuickPaneEntry('   ')

    expect(getLastQuickPaneEntry()).toBe('kept')
    expect(toastSuccess).toHaveBeenCalledOnce()
  })
})
