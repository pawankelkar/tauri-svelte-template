import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockIPC } from '@tauri-apps/api/mocks'
import type { NetPolicy, RequestRecord } from '$lib/tauri-bindings'
import {
  getContextKey,
  resetContextKeys,
} from '$lib/commands/context-keys.svelte'
import { toast } from '$lib/stores/toast'
import {
  initNetwork,
  getNetworkPolicy,
  isOffline,
  isNetworkReady,
  getNetworkActivity,
  setOffline,
  setAllowLocalhost,
  loadActivity,
  clearActivity,
  __resetNetworkForTests,
} from './network.svelte'

const handlers = new Map<string, (event: { payload: unknown }) => void>()
const unlisten = vi.fn()

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((event: string, cb: (event: { payload: unknown }) => void) => {
    handlers.set(event, cb)
    return Promise.resolve(unlisten)
  }),
}))

vi.mock('$lib/stores/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

const online: NetPolicy = {
  offline: false,
  allowLocalhost: true,
  allowedHosts: ['updates.example.com'],
}

const record = (overrides: Partial<RequestRecord> = {}): RequestRecord => ({
  timestampMs: 1_700_000_000_000,
  method: 'GET',
  host: 'updates.example.com',
  url: 'https://updates.example.com/latest.json',
  purpose: 'updater',
  outcome: 'sent',
  status: 200,
  bytes: 512,
  error: null,
  ...overrides,
})

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  __resetNetworkForTests()
  resetContextKeys()
  handlers.clear()
  vi.clearAllMocks()
})

describe('defaults', () => {
  it('assumes offline before the policy loads', () => {
    expect(isOffline()).toBe(true)
    expect(isNetworkReady()).toBe(false)
  })
})

describe('initNetwork', () => {
  it('loads the policy and publishes the offline context key', async () => {
    mockIPC((cmd) => {
      if (cmd === 'get_network_status') return online
    })

    const cleanup = initNetwork()
    expect(getContextKey('offline')).toBe(true)
    await flush()

    expect(getNetworkPolicy()).toEqual(online)
    expect(isNetworkReady()).toBe(true)
    expect(getContextKey('offline')).toBe(false)
    cleanup()
    expect(unlisten).toHaveBeenCalled()
  })

  it('follows network:policy-changed events', async () => {
    mockIPC((cmd) => {
      if (cmd === 'get_network_status') return online
    })
    initNetwork()
    await flush()

    handlers.get('network:policy-changed')?.({
      payload: { ...online, offline: true },
    })

    expect(isOffline()).toBe(true)
    expect(getContextKey('offline')).toBe(true)
  })

  it('stays offline when loading fails', async () => {
    mockIPC((cmd) => {
      if (cmd === 'get_network_status') throw new Error('boom')
    })
    initNetwork()
    await flush()

    expect(isOffline()).toBe(true)
    expect(isNetworkReady()).toBe(false)
  })
})

describe('setOffline', () => {
  it('sends the flag and applies the returned policy', async () => {
    let received: unknown
    mockIPC((cmd, args) => {
      if (cmd === 'set_offline_mode') {
        received = args
        return online
      }
    })

    expect(await setOffline(false)).toBe(true)
    expect(received).toEqual({ offline: false })
    expect(isOffline()).toBe(false)
    expect(getContextKey('offline')).toBe(false)
  })

  it('toasts a described CoreError and keeps the old policy', async () => {
    mockIPC((cmd) => {
      if (cmd === 'set_offline_mode') {
        throw { kind: 'internal', message: 'disk full' }
      }
    })

    expect(await setOffline(false)).toBe(false)
    expect(isOffline()).toBe(true)
    expect(toast.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        description: expect.stringContaining('disk full'),
      }),
    )
  })
})

describe('setAllowLocalhost', () => {
  it('sends the flag and applies the returned policy', async () => {
    let received: unknown
    mockIPC((cmd, args) => {
      if (cmd === 'set_allow_localhost') {
        received = args
        return { ...online, allowLocalhost: false }
      }
    })

    expect(await setAllowLocalhost(false)).toBe(true)
    expect(received).toEqual({ allow: false })
    expect(getNetworkPolicy().allowLocalhost).toBe(false)
  })
})

describe('activity', () => {
  it('loads the log as returned (newest first)', async () => {
    const records = [record({ timestampMs: 2 }), record({ timestampMs: 1 })]
    mockIPC((cmd) => {
      if (cmd === 'list_network_activity') return records
    })

    await loadActivity()
    expect(getNetworkActivity()).toEqual(records)
  })

  it('clears the log', async () => {
    mockIPC((cmd) => {
      if (cmd === 'list_network_activity') return [record()]
      if (cmd === 'clear_network_activity') return null
    })
    await loadActivity()

    await clearActivity()
    expect(getNetworkActivity()).toEqual([])
  })

  it('keeps the log and toasts when clearing fails', async () => {
    mockIPC((cmd) => {
      if (cmd === 'list_network_activity') return [record()]
      if (cmd === 'clear_network_activity') throw new Error('nope')
    })
    await loadActivity()

    await clearActivity()
    expect(getNetworkActivity()).toHaveLength(1)
    expect(toast.error).toHaveBeenCalled()
  })
})
