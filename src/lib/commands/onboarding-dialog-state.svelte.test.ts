import { describe, it, expect, beforeEach } from 'vitest'
import {
  isOnboardingDialogOpen,
  openOnboardingDialog,
  closeOnboardingDialog,
  setOnboardingDialogOpen,
  __resetOnboardingDialogStateForTests,
} from './onboarding-dialog-state.svelte'

beforeEach(() => {
  __resetOnboardingDialogStateForTests()
})

describe('onboarding dialog state', () => {
  it('starts closed', () => {
    expect(isOnboardingDialogOpen()).toBe(false)
  })

  it('opens and closes', () => {
    openOnboardingDialog()
    expect(isOnboardingDialogOpen()).toBe(true)

    closeOnboardingDialog()
    expect(isOnboardingDialogOpen()).toBe(false)
  })

  it('follows setOpen in both directions', () => {
    setOnboardingDialogOpen(true)
    expect(isOnboardingDialogOpen()).toBe(true)

    setOnboardingDialogOpen(false)
    expect(isOnboardingDialogOpen()).toBe(false)
  })
})
