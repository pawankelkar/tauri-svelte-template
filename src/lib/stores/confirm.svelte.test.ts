import { describe, it, expect, beforeEach } from 'vitest'
import {
  confirm,
  confirmAccept,
  confirmCancel,
  getConfirmRequest,
  __resetConfirmForTests,
} from './confirm.svelte'

beforeEach(() => {
  __resetConfirmForTests()
})

/** Resolves to a sentinel if the promise has not settled by the next tick. */
async function settledValue<T>(
  promise: Promise<T>,
): Promise<T | 'still-pending'> {
  return Promise.race([
    promise,
    Promise.resolve().then(() => 'still-pending' as const),
  ])
}

describe('confirm', () => {
  it('exposes the pending request and stays unresolved until settled', async () => {
    const pending = confirm({
      titleKey: 'welcome.confirm.title',
      descriptionKey: 'welcome.confirm.description',
      destructive: true,
    })

    const request = getConfirmRequest()
    expect(request).not.toBeNull()
    expect(request?.titleKey).toBe('welcome.confirm.title')
    expect(request?.descriptionKey).toBe('welcome.confirm.description')
    expect(request?.destructive).toBe(true)

    expect(await settledValue(pending)).toBe('still-pending')

    confirmCancel()
    await pending
  })

  it('resolves true and clears the request on accept', async () => {
    const pending = confirm({ titleKey: 'a' })
    confirmAccept()

    expect(await pending).toBe(true)
    expect(getConfirmRequest()).toBeNull()
  })

  it('resolves false and clears the request on cancel', async () => {
    const pending = confirm({ titleKey: 'a' })
    confirmCancel()

    expect(await pending).toBe(false)
    expect(getConfirmRequest()).toBeNull()
  })

  it('cancels a pending request when a second confirm arrives', async () => {
    const first = confirm({ titleKey: 'first' })
    const second = confirm({ titleKey: 'second' })

    expect(await first).toBe(false)
    expect(getConfirmRequest()?.titleKey).toBe('second')

    confirmAccept()
    expect(await second).toBe(true)
  })

  it('resolves a pending request as cancelled when reset for tests', async () => {
    const pending = confirm({ titleKey: 'a' })
    __resetConfirmForTests()

    expect(await pending).toBe(false)
    expect(getConfirmRequest()).toBeNull()
  })
})
