// Writes derived tokens as inline custom properties on the root element.
// Ported from the author's sarde-studio project (src/lib/theme/apply.js).
//
// Inline styles on <html> are the only source of --sd-* values — app.css
// references them with static fallbacks that reproduce the default look
// until the first paint lands.

import { TOKEN_NAMES, type ThemeTokens } from './engine'

export function applyTokens(
  tokens: Partial<ThemeTokens>,
  target: HTMLElement = document.documentElement,
): void {
  for (const name of TOKEN_NAMES) {
    if (tokens[name] != null)
      target.style.setProperty(`--sd-${name}`, tokens[name])
  }
}
