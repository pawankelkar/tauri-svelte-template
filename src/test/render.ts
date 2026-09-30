/**
 * Minimal component harness for Svelte 5 (no @testing-library/svelte):
 * mounts into a detached-then-attached div and unmounts on cleanup.
 */
import { flushSync, mount, tick, unmount, type Component } from 'svelte'

export interface Rendered {
  target: HTMLElement
  cleanup: () => void
}

export function render<P extends Record<string, unknown>>(
  component: Component<P>,
  props?: P,
): Rendered {
  const target = document.createElement('div')
  document.body.appendChild(target)
  const instance = mount(component, { target, props: props ?? ({} as P) })
  flushSync()
  return {
    target,
    cleanup: () => {
      void unmount(instance)
      target.remove()
    },
  }
}

/** Lets pending promises, timers at 0 ms and Svelte effects settle. */
export async function settle(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((r) => setTimeout(r, 0))
    await tick()
  }
}

export function typeInto(input: HTMLInputElement, value: string): void {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}

export function press(
  el: Element,
  key: string,
  init: KeyboardEventInit = {},
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  })
  el.dispatchEvent(event)
  flushSync()
  return event
}
