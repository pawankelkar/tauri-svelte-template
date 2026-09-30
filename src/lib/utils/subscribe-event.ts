import { listen } from '@tauri-apps/api/event'
import { warn } from '$lib/logger'

/**
 * Subscribes to a backend event and returns a synchronous cleanup.
 *
 * `listen()` resolves asynchronously, so a caller that tears down before it
 * settles (HMR, a fast unmount) would otherwise leak the listener. The
 * returned function is safe to call at any point: if the subscription is
 * still in flight it is released the moment it lands.
 */
export function subscribeEvent<T>(
  event: string,
  handler: (payload: T) => void,
): () => void {
  let unlisten: (() => void) | undefined
  let cancelled = false

  listen<T>(event, (e) => handler(e.payload))
    .then((fn) => {
      if (cancelled) fn()
      else unlisten = fn
    })
    .catch((e: unknown) => warn(`Subscribing to ${event} failed:`, e))

  return () => {
    cancelled = true
    unlisten?.()
  }
}
