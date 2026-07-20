import type { Action } from 'svelte/action'
import { showTextInputContextMenu } from '$lib/context-menu'

/**
 * Gives a plain `<input>` or `<textarea>` the native
 * Undo/Redo/Cut/Copy/Paste/Select All menu on right-click, in place of the
 * webview's own.
 *
 * Use this on real DOM elements. Svelte 5 does not allow `use:` on a
 * component, so component-based inputs — bits-ui's `Command.Input`, for one —
 * have to take `oncontextmenu` as a prop instead. See `CommandPalette.svelte`.
 */
export const textInputContextMenu: Action<HTMLElement> = (node) => {
  const handler = (e: MouseEvent) => {
    e.preventDefault()
    void showTextInputContextMenu()
  }
  node.addEventListener('contextmenu', handler)
  return {
    destroy() {
      node.removeEventListener('contextmenu', handler)
    },
  }
}
