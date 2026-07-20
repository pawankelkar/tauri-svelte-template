import type { Action } from 'svelte/action'
import {
  showTextInputContextMenu,
  showEditContextMenu,
} from '$lib/context-menu'

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

export const editContextMenu: Action<HTMLElement> = (node) => {
  const handler = (e: MouseEvent) => {
    e.preventDefault()
    void showEditContextMenu()
  }
  node.addEventListener('contextmenu', handler)
  return {
    destroy() {
      node.removeEventListener('contextmenu', handler)
    },
  }
}
