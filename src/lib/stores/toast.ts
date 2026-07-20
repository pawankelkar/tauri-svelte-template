import { toast as sonnerToast } from 'svelte-sonner'

/**
 * Thin wrapper over svelte-sonner.
 *
 * App code imports from here rather than from `svelte-sonner` directly — the
 * same seam `tauri-bindings.ts` provides over the generated bindings. It keeps
 * one import surface, narrows the option bag to what this template supports,
 * and lets tests mock `$lib/stores/toast` instead of reaching into the toast
 * library's internals.
 */

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastOptions {
  description?: string
  duration?: number
  action?: ToastAction
}

export const toast = {
  success: (message: string, options?: ToastOptions) =>
    sonnerToast.success(message, options),
  error: (message: string, options?: ToastOptions) =>
    sonnerToast.error(message, options),
  info: (message: string, options?: ToastOptions) =>
    sonnerToast.info(message, options),
  warning: (message: string, options?: ToastOptions) =>
    sonnerToast.warning(message, options),
  message: (message: string, options?: ToastOptions) =>
    sonnerToast(message, options),
  dismiss: (id?: string | number) => sonnerToast.dismiss(id),
}
