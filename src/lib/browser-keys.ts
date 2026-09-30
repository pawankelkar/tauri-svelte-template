import type { AppPlatform } from '$lib/hooks/use-platform.svelte'

/**
 * Keys the webview answers itself, drawn over the app as browser chrome.
 *
 * On Windows, Ctrl+F pops WebView2's find bar into the top-right corner;
 * Ctrl+P opens a print dialog. Neither belongs in a desktop app that never
 * asked for them. The webview settings that would turn these off wholesale
 * (`AreBrowserAcceleratorKeysEnabled`) exist in wry but are not reachable
 * through Tauri 2.11, so the page cancels them instead — which works because
 * Chromium treats these as page-cancellable, unlike the truly reserved combos
 * (Ctrl+T, Ctrl+W, Ctrl+N) a webview never receives anyway.
 */
const SUPPRESSED_KEYS = new Set([
  'f', // find bar
  'g', // find next / previous (with Shift)
  'p', // print
])

export interface BrowserKeyOptions {
  /**
   * Also swallow reload (Ctrl+R / Cmd+R / F5, and their Shift and Ctrl
   * hard-reload variants).
   *
   * Separate from the rest because reload is the one webview default with a
   * legitimate development use. In a shipped app it is destructive: the
   * frontend is a single page, so a reload tears down every store and throws
   * away whatever the user had in flight.
   */
  reload?: boolean
}

/**
 * Whether this keypress is browser chrome the app should swallow.
 *
 * Only the platform's own primary modifier counts: on macOS the find bar is
 * Cmd+F, and matching bare Ctrl+F there would break the Emacs-style cursor
 * bindings macOS text fields provide.
 *
 * Shift is deliberately not excluded — Ctrl+Shift+G is find-previous. Matching
 * a combo an app command also owns is harmless: suppression only calls
 * `preventDefault()`, so the command dispatcher still sees the event and runs.
 */
export function isSuppressedBrowserKey(
  event: KeyboardEvent,
  platform: AppPlatform,
  options: BrowserKeyOptions = {},
): boolean {
  // Find-next on Windows and Linux, and it carries no modifier.
  if (event.key === 'F3') return true
  // Neither does reload, in either its plain or its hard (Ctrl/Shift) form.
  if (event.key === 'F5') return options.reload === true

  const primary = platform === 'macos' ? event.metaKey : event.ctrlKey
  const secondary = platform === 'macos' ? event.ctrlKey : event.metaKey
  if (!primary || secondary || event.altKey) return false

  const key = event.key.toLowerCase()
  if (key === 'r') return options.reload === true
  return SUPPRESSED_KEYS.has(key)
}

/** Events the suppressor cancelled, so the command dispatcher can tell. */
const suppressedEvents = new WeakSet<Event>()

/**
 * Whether the suppressor (not a component) cancelled this event. The command
 * dispatcher skips events something already consumed, but a cancelled find
 * bar is not a consumed key: Cmd+F and Cmd+Shift+F are app commands.
 */
export function wasSuppressedBrowserKey(event: Event): boolean {
  return suppressedEvents.has(event)
}

/**
 * Installs the suppressor on `window` and returns its teardown.
 *
 * Listens in the capture phase so the browser default is cancelled before any
 * component handler can call `stopPropagation()` and strand it.
 */
export function initBrowserKeySuppression(
  platform: AppPlatform,
  options: BrowserKeyOptions = {},
): () => void {
  const handler = (event: KeyboardEvent): void => {
    if (!isSuppressedBrowserKey(event, platform, options)) return
    suppressedEvents.add(event)
    event.preventDefault()
  }
  window.addEventListener('keydown', handler, { capture: true })
  return () => {
    window.removeEventListener('keydown', handler, { capture: true })
  }
}
