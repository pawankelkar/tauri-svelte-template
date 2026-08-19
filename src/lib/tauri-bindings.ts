export {
  commands,
  type Result,
  type AppPreferences,
  type CrashReportSummary,
  type DiagnosticsReport,
  type ImportedTheme,
  type ThemeProfile,
  type PersistedAppState,
  type ShortcutPurpose,
  type JsonValue,
} from './bindings'

export function unwrapResult<T, E>(
  result: { status: 'ok'; data: T } | { status: 'error'; error: E },
): T {
  if (result.status === 'ok') return result.data
  throw result.error
}
