import { commands, unwrapResult } from '$lib/tauri-bindings'
import type { FeatureEntitlement, ProFeature } from '$lib/tauri-bindings'
import { setContextKey } from '$lib/commands/context-keys.svelte'
import { describeError } from '$lib/core-error'
import { t } from '$lib/i18n/t.svelte'
import { warn } from '$lib/logger'
import { toast } from '$lib/stores/toast'
import { subscribeEvent } from '$lib/utils/subscribe-event'

/**
 * Pro feature flags, mirrored from Rust.
 *
 * These are local flags, not a licence check: Rust stores them and gates the
 * matching commands with `CoreError::NotEntitled`. The frontend reads them to
 * decide what to show, and follows `entitlements:changed` so every window
 * agrees.
 */

const ENTITLEMENTS_CHANGED_EVENT = 'entitlements:changed'

let _entitlements = $state<FeatureEntitlement[]>([])

function applyEntitlements(list: FeatureEntitlement[]): void {
  _entitlements = list
  setContextKey(
    'pro',
    list.some((e) => e.enabled),
  )
}

export function getEntitlements(): FeatureEntitlement[] {
  return _entitlements
}

export function isEntitled(feature: ProFeature): boolean {
  return _entitlements.some((e) => e.feature === feature && e.enabled)
}

/** Whether any Pro feature is switched on (mirrors the `pro` context key). */
export function hasAnyEntitlement(): boolean {
  return _entitlements.some((e) => e.enabled)
}

export async function refreshEntitlements(): Promise<FeatureEntitlement[]> {
  try {
    applyEntitlements(await commands.getEntitlements())
  } catch (e) {
    warn('Loading entitlements failed:', e)
  }
  return _entitlements
}

/**
 * Loads the flags and follows them from then on. Returns the cleanup that
 * drops the event subscription.
 */
export function initEntitlements(): () => void {
  setContextKey('pro', hasAnyEntitlement())
  const unsubscribe = subscribeEvent<FeatureEntitlement[]>(
    ENTITLEMENTS_CHANGED_EVENT,
    applyEntitlements,
  )
  void refreshEntitlements()
  return unsubscribe
}

/** Flips one flag. Resolves `false` (after a toast) on failure. */
export async function setEntitlement(
  feature: ProFeature,
  enabled: boolean,
): Promise<boolean> {
  try {
    applyEntitlements(
      unwrapResult(await commands.setEntitlement(feature, enabled)),
    )
    return true
  } catch (e) {
    toast.error(t('pro.setEntitlementError'), {
      description: describeError(e),
    })
    return false
  }
}

export function __resetEntitlementsForTests(): void {
  _entitlements = []
}
