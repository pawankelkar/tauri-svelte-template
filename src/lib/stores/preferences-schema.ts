import type { AppPreferences } from '$lib/tauri-bindings'

export type ThemeMode = 'light' | 'dark' | 'system'

const THEME_MODES: readonly ThemeMode[] = ['light', 'dark', 'system']

export function isThemeMode(value: unknown): value is ThemeMode {
  return (
    typeof value === 'string' &&
    (THEME_MODES as readonly string[]).includes(value)
  )
}

export function defaultPreferences(): AppPreferences {
  return {
    theme: 'system',
    language: null,
    globalShortcut: null,
    quickPaneShortcut: null,
  }
}

export function sanitizePreferences(raw: unknown): AppPreferences {
  const defaults = defaultPreferences()
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw))
    return defaults

  const r = raw as Partial<AppPreferences>
  return {
    theme: isThemeMode(r.theme) ? r.theme : defaults.theme,
    language: typeof r.language === 'string' ? r.language : null,
    globalShortcut:
      typeof r.globalShortcut === 'string' ? r.globalShortcut : null,
    quickPaneShortcut:
      typeof r.quickPaneShortcut === 'string' ? r.quickPaneShortcut : null,
  }
}
