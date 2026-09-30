/**
 * Test backend: the browser preview's in-memory vault behind `mockIPC`,
 * with Tauri events mocked so `vault:fs-changed` and friends reach the
 * stores. Tests can override single commands and inspect every call.
 */
import { mockIPC } from '@tauri-apps/api/mocks'
import { emit } from '@tauri-apps/api/event'
import { createFakeVault, type FakeVault } from '$lib/dev/fake-vault'

type Handler = (args: Record<string, unknown>) => unknown

export interface FakeBackend {
  fake: FakeVault
  /** Every command invoked, in order. */
  calls: { cmd: string; args: Record<string, unknown> }[]
  /** Replaces one command (or plugin command) for the rest of the test. */
  override: (cmd: string, handler: Handler) => void
  /** Calls the fake directly, bypassing IPC. */
  call: <T>(cmd: string, args?: Record<string, unknown>) => T
  /** Names of the commands invoked so far. */
  commandNames: () => string[]
}

export const TEST_VAULT_PATH = '/Users/me/Notes'

export function installFakeBackend(
  options: { open?: boolean } = {},
): FakeBackend {
  const fake = createFakeVault({
    emitEvent: (event, payload) => emit(event, payload),
    now: () => 1_790_000_000_000,
    // Reindex progress never advances on its own in tests.
    schedule: () => {},
  })
  const overrides: Record<string, Handler> = {}
  const calls: FakeBackend['calls'] = []
  mockIPC(
    (cmd, args) => {
      const named = (args ?? {}) as Record<string, unknown>
      calls.push({ cmd, args: named })
      const handler = overrides[cmd] ?? fake.handlers[cmd]
      return handler ? handler(named) : null
    },
    { shouldMockEvents: true },
  )
  const call = <T>(cmd: string, args: Record<string, unknown> = {}): T => {
    const handler = fake.handlers[cmd]
    if (!handler) throw new Error(`no fake handler for ${cmd}`)
    return handler(args) as T
  }
  if (options.open) call('vault_open', { path: TEST_VAULT_PATH })
  return {
    fake,
    calls,
    override: (cmd, handler) => {
      overrides[cmd] = handler
    },
    call,
    commandNames: () => calls.map((c) => c.cmd),
  }
}
