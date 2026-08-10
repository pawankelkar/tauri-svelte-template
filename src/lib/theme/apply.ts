// Writes derived tokens as inline custom properties on the root element.
// Ported from the author's sarde-studio project (src/lib/theme/apply.js).
//
// Inline styles on <html> are the only source of --sd-* values — app.css
// references them with static fallbacks that reproduce the default look
// until the first paint lands.

import { TOKEN_NAMES, type ThemeTokens } from './engine'
import { uiFontStack } from './fonts'

export function applyTokens(
  tokens: Partial<ThemeTokens>,
  target: HTMLElement = document.documentElement,
): void {
  for (const name of TOKEN_NAMES) {
    if (tokens[name] != null)
      target.style.setProperty(`--sd-${name}`, tokens[name])
  }
}

/**
 * The non-colour appearance vars. `--sd-font-size` lands on the root, so
 * rem-based sizing scales with it — it is the UI scale, not a text size.
 */
export function applyAppearanceTokens(
  fontFamily: string | null,
  fontSize: number,
  target: HTMLElement = document.documentElement,
): void {
  target.style.setProperty('--sd-font-ui', uiFontStack(fontFamily))
  target.style.setProperty('--sd-font-size', `${fontSize}px`)
}
