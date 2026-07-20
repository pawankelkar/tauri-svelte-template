export const THEME_STORAGE_KEY = 'ui-theme'

export function paintFromHint(
  target: HTMLElement = document.documentElement,
): void {
  const stored = localStorage.getItem(THEME_STORAGE_KEY)
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const isDark = stored === 'dark' || (stored !== 'light' && prefersDark)
  target.classList.toggle('dark', isDark)
}
