import { describe, it, expect, beforeEach } from 'vitest'
import {
  isPreferencesDialogOpen,
  getActivePreferencesPane,
  setActivePreferencesPane,
  openPreferencesDialog,
  closePreferencesDialog,
  setPreferencesDialogOpen,
  __resetPreferencesDialogStateForTests,
} from './preferences-dialog-state.svelte'

beforeEach(() => {
  __resetPreferencesDialogStateForTests()
})

describe('preferences dialog state', () => {
  it('starts closed on the general pane', () => {
    expect(isPreferencesDialogOpen()).toBe(false)
    expect(getActivePreferencesPane()).toBe('general')
  })

  it('opens without changing the active pane when none is given', () => {
    setActivePreferencesPane('advanced')
    openPreferencesDialog()

    expect(isPreferencesDialogOpen()).toBe(true)
    expect(getActivePreferencesPane()).toBe('advanced')
  })

  it('opens directly onto a requested pane', () => {
    openPreferencesDialog('appearance')

    expect(isPreferencesDialogOpen()).toBe(true)
    expect(getActivePreferencesPane()).toBe('appearance')
  })

  it('keeps the active pane after closing', () => {
    openPreferencesDialog('appearance')
    closePreferencesDialog()

    expect(isPreferencesDialogOpen()).toBe(false)
    expect(getActivePreferencesPane()).toBe('appearance')
  })

  it('mirrors the dialog open state for two-way binding', () => {
    setPreferencesDialogOpen(true)
    expect(isPreferencesDialogOpen()).toBe(true)

    setPreferencesDialogOpen(false)
    expect(isPreferencesDialogOpen()).toBe(false)
  })

  it('resets both open state and pane for tests', () => {
    openPreferencesDialog('advanced')
    __resetPreferencesDialogStateForTests()

    expect(isPreferencesDialogOpen()).toBe(false)
    expect(getActivePreferencesPane()).toBe('general')
  })
})
