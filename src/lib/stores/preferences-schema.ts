import type { AppPreferences } from '$lib/tauri-bindings'

export type ThemeMode = 'light' | 'dark' | 'system'

const THEME_MODES: readonly ThemeMode[] = ['light', 'dark', 'system']

export function isThemeMode(value: unknown): value is ThemeMode {
  return (
    typeof value === 'string' &&
    (THEME_MODES as readonly string[]).includes(value)
  )
}

/**
 * Mirrors `DEFAULT_QUICK_PANE_SHORTCUT` in `src-tauri/src/types.rs`.
 *
 * Rust owns the authoritative default — it registers the accelerator during
 * `setup()`, before the frontend exists — but the value is repeated here so a
 * failed load still shows the user what is actually bound.
 */
export const DEFAULT_QUICK_PANE_SHORTCUT = 'CmdOrCtrl+Shift+.'

export function defaultPreferences(): AppPreferences {
  return {
    theme: 'system',
    language: null,
    globalShortcut: null,
    quickPaneShortcut: DEFAULT_QUICK_PANE_SHORTCUT,
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
