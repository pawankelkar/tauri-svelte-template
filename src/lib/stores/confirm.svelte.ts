/**
 * Promise-based confirmation dialog.
 *
 * `ConfirmDialog.svelte` is mounted once globally and renders whatever request
 * is pending here, so any module can `await confirm({ ... })` without owning a
 * dialog of its own.
 *
 * Copy lives as i18n keys rather than strings so confirmations stay
 * translatable.
 */

export interface ConfirmOptions {
  titleKey: string
  titleOptions?: Record<string, unknown>
  descriptionKey?: string
  descriptionOptions?: Record<string, unknown>
  confirmKey?: string
  cancelKey?: string
  /** Styles the confirm button as destructive. */
  destructive?: boolean
}

interface ConfirmRequest extends ConfirmOptions {
  resolve: (value: boolean) => void
}

let _request = $state<ConfirmRequest | null>(null)

export function getConfirmRequest(): ConfirmRequest | null {
  return _request
}

/**
 * Shows a confirmation and resolves to the user's answer.
 *
 * Only one confirmation is visible at a time: a second call resolves the
 * pending one as cancelled and replaces it rather than queueing.
 */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    _request?.resolve(false)
    _request = { ...options, resolve }
  })
}

function settle(result: boolean): void {
  _request?.resolve(result)
  _request = null
}

export function confirmAccept(): void {
  settle(true)
}

export function confirmCancel(): void {
  settle(false)
}

export function __resetConfirmForTests(): void {
  settle(false)
}
