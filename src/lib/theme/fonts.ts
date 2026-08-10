// UI font stack construction. Adapted from the author's sarde-studio
// project (src/lib/theme/fonts.js): the stored preference is a bare family
// name (or null for "system default"); the CSS value always carries the
// platform fallbacks behind it so a missing font degrades gracefully.

export const SYSTEM_FONT_FALLBACK =
  "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

export function uiFontStack(family: string | null): string {
  const trimmed = family?.trim()
  if (!trimmed) return SYSTEM_FONT_FALLBACK
  const quoted = /^[\w-]+$/.test(trimmed)
    ? trimmed
    : `'${trimmed.replace(/'/g, "\\'")}'`
  return `${quoted}, ${SYSTEM_FONT_FALLBACK}`
}
