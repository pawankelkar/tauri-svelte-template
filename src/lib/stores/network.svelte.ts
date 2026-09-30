import { commands, unwrapResult } from '$lib/tauri-bindings'
import type {
  CoreError,
  NetPolicy,
  RequestRecord,
  Result,
} from '$lib/tauri-bindings'
import { setContextKey } from '$lib/commands/context-keys.svelte'
import { describeError } from '$lib/core-error'
import { t } from '$lib/i18n/t.svelte'
import { warn } from '$lib/logger'
import { toast } from '$lib/stores/toast'
import { subscribeEvent } from '$lib/utils/subscribe-event'

/**
 * The frontend mirror of the Rust network policy (ostralith-net).
 *
 * Rust owns the policy; this store only reflects it. Every change — made
 * here, from the tray, or by another window — arrives on
 * `network:policy-changed`, so the UI never drifts from what the backend
 * actually enforces.
 */

const POLICY_CHANGED_EVENT = 'network:policy-changed'

// Offline until proven otherwise: before the real policy loads, the UI must
// never suggest that the network is reachable.
const defaultPolicy = (): NetPolicy => ({
  offline: true,
  allowLocalhost: true,
  allowedHosts: [],
})

let _policy = $state<NetPolicy>(defaultPolicy())
let _ready = $state(false)
let _activity = $state<RequestRecord[]>([])

function applyPolicy(policy: NetPolicy): void {
  _policy = policy
  setContextKey('offline', policy.offline)
}

export function getNetworkPolicy(): NetPolicy {
  return _policy
}

export function isOffline(): boolean {
  return _policy.offline
}

export function isNetworkReady(): boolean {
  return _ready
}

/** The activity log as last loaded, newest first. */
export function getNetworkActivity(): RequestRecord[] {
  return _activity
}

/** Re-reads the policy from Rust. */
export async function refreshNetworkPolicy(): Promise<NetPolicy> {
  try {
    applyPolicy(await commands.getNetworkStatus())
    _ready = true
  } catch (e) {
    warn('Loading the network policy failed:', e)
  }
  return _policy
}

/**
 * Loads the policy and follows it from then on. Returns the cleanup that
 * drops the event subscription.
 */
export function initNetwork(): () => void {
  // Publish the pessimistic default straight away so `when: '!offline'`
  // bindings are correct before the first IPC round-trip lands.
  setContextKey('offline', _policy.offline)
  const unsubscribe = subscribeEvent<NetPolicy>(POLICY_CHANGED_EVENT, (p) => {
    applyPolicy(p)
    _ready = true
  })
  void refreshNetworkPolicy()
  return unsubscribe
}

async function updatePolicy(
  call: () => Promise<Result<NetPolicy, CoreError>>,
  errorKey: string,
): Promise<boolean> {
  try {
    applyPolicy(unwrapResult(await call()))
    return true
  } catch (e) {
    toast.error(t(errorKey), { description: describeError(e) })
    return false
  }
}

/** Turns offline mode on or off. Resolves `false` (after a toast) on failure. */
export function setOffline(offline: boolean): Promise<boolean> {
  return updatePolicy(
    () => commands.setOfflineMode($state.snapshot(offline)),
    'network.setOfflineError',
  )
}

/** Lets loopback requests through while offline, or not. */
export function setAllowLocalhost(allow: boolean): Promise<boolean> {
  return updatePolicy(
    () => commands.setAllowLocalhost($state.snapshot(allow)),
    'network.setAllowLocalhostError',
  )
}

export async function loadActivity(): Promise<RequestRecord[]> {
  try {
    _activity = await commands.listNetworkActivity()
  } catch (e) {
    warn('Loading network activity failed:', e)
  }
  return _activity
}

export async function clearActivity(): Promise<void> {
  try {
    await commands.clearNetworkActivity()
    _activity = []
  } catch (e) {
    toast.error(t('network.clearActivityError'), {
      description: describeError(e),
    })
  }
}

export function __resetNetworkForTests(): void {
  _policy = defaultPolicy()
  _ready = false
  _activity = []
}
