import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockIPC } from '@tauri-apps/api/mocks'
import type { FeatureEntitlement } from '$lib/tauri-bindings'
import {
  getContextKey,
  resetContextKeys,
} from '$lib/commands/context-keys.svelte'
import { toast } from '$lib/stores/toast'
import {
  initEntitlements,
  getEntitlements,
  isEntitled,
  hasAnyEntitlement,
  setEntitlement,
  __resetEntitlementsForTests,
} from './entitlements.svelte'

const handlers = new Map<string, (event: { payload: unknown }) => void>()

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((event: string, cb: (event: { payload: unknown }) => void) => {
    handlers.set(event, cb)
    return Promise.resolve(() => {})
  }),
}))

vi.mock('$lib/stores/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

const allOff = (): FeatureEntitlement[] => [
  { feature: 'realtimeTranslation', enabled: false },
  { feature: 'pdfAiQa', enabled: false },
  { feature: 'premiumCloudModels', enabled: false },
]

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  __resetEntitlementsForTests()
  resetContextKeys()
  handlers.clear()
  vi.clearAllMocks()
})

describe('initEntitlements', () => {
  it('loads the flags and sets pro=false when none are on', async () => {
    mockIPC((cmd) => {
      if (cmd === 'get_entitlements') return allOff()
    })

    initEntitlements()
    await flush()

    expect(getEntitlements()).toHaveLength(3)
    expect(isEntitled('pdfAiQa')).toBe(false)
    expect(hasAnyEntitlement()).toBe(false)
    expect(getContextKey('pro')).toBe(false)
  })

  it('follows entitlements:changed events', async () => {
    mockIPC((cmd) => {
      if (cmd === 'get_entitlements') return allOff()
    })
    initEntitlements()
    await flush()

    const next = allOff()
    next[1]!.enabled = true
    handlers.get('entitlements:changed')?.({ payload: next })

    expect(isEntitled('pdfAiQa')).toBe(true)
    expect(isEntitled('realtimeTranslation')).toBe(false)
    expect(getContextKey('pro')).toBe(true)
  })
})

describe('setEntitlement', () => {
  it('sends the flag and applies the returned list', async () => {
    let received: unknown
    mockIPC((cmd, args) => {
      if (cmd === 'set_entitlement') {
        received = args
        const next = allOff()
        next[2]!.enabled = true
        return next
      }
    })

    expect(await setEntitlement('premiumCloudModels', true)).toBe(true)
    expect(received).toEqual({ feature: 'premiumCloudModels', enabled: true })
    expect(isEntitled('premiumCloudModels')).toBe(true)
    expect(getContextKey('pro')).toBe(true)
  })

  it('toasts and leaves flags untouched on error', async () => {
    mockIPC((cmd) => {
      if (cmd === 'set_entitlement') {
        throw { kind: 'invalidInput', message: 'unknown feature' }
      }
    })

    expect(await setEntitlement('pdfAiQa', true)).toBe(false)
    expect(isEntitled('pdfAiQa')).toBe(false)
    expect(toast.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        description: expect.stringContaining('unknown feature'),
      }),
    )
  })
})
