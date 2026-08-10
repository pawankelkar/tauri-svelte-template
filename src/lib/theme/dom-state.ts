// The root element state the theme system maintains, kept in one place so
// the pre-mount paint (paint-hint.ts) and the live apply path
// (stores/theme.svelte.ts) can never disagree. Ported from the author's
// sarde-studio project (src/lib/theme/dom-state.js), extended with the
// template's `.dark` class contract.

import type { ThemeVariantMode } from './engine'

/**
 * Stamps the painted preset and mode onto the root element.
 *
 * `data-color-mode` / `data-theme-preset` exist for CSS hooks and debugging;
 * the `.dark` class is what the Tailwind `dark:` variant and the app.css
 * fallback palette key off. `mode` is the *painted* variant's mode — a
 * dark-only preset keeps `.dark` on even while the user's toggle says light.
 *
 * `reducedMotion` is the *resolved* boolean (a 'system' preference is
 * resolved by the caller via resolveReducedMotion) so the CSS consumer is a
 * plain `[data-reduced-motion='true']` selector.
 */
export function applyDomState(
  presetId: string,
  mode: ThemeVariantMode,
  reducedMotion: boolean,
  pointerCursors: boolean,
  target: HTMLElement = document.documentElement,
): void {
  target.classList.toggle('dark', mode === 'dark')
  target.setAttribute('data-color-mode', mode)
  target.setAttribute('data-theme-preset', presetId)
  target.setAttribute('data-reduced-motion', String(reducedMotion))
  target.setAttribute('data-cursor', pointerCursors ? 'pointer' : 'default')
}
