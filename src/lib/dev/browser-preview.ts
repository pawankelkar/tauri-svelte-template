/**
 * Dev-only browser preview: lets the frontend boot at http://localhost:1420/
 * in a plain browser, outside the Tauri webview.
 *
 * Outside Tauri there is no `window.__TAURI_INTERNALS__`, so the first
 * `getCurrentWindow()` or `invoke()` throws and nothing mounts. This module
 * installs `@tauri-apps/api/mocks` with an in-memory stand-in for every Rust
 * command and plugin call the app makes, so the UI renders and the main flows
 * (palette, Preferences, offline toggle, Pro flags) work for layout and
 * styling work. The P1 vault, search and backup commands are served by the
 * in-memory vault in `./fake-vault`.
 *
 * Only ever reached through the `import.meta.env.DEV` dynamic import in
 * `src/main.ts` / `src/quick-pane-main.ts`, so production builds never
 * contain it. Nothing here goes through the real IPC: the mock sits *under*
 * the generated bindings, which is why no raw `invoke()` appears.
 */
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks'
import { emit } from '@tauri-apps/api/event'
import type { InvokeArgs } from '@tauri-apps/api/core'
import type {
  AppPreferences,
  CoreError,
  DiagnosticsReport,
  FeatureEntitlement,
  NetPolicy,
  PersistedAppState,
  ProFeature,
  RequestRecord,
} from '$lib/tauri-bindings'
import { defaultPreferences } from '$lib/stores/preferences-schema'
import { defaultAppState } from '$lib/stores/app-state-schema'
import { logger } from '$lib/logger'
import { createFakeVault, type FakeVault } from './fake-vault'
import { version as APP_VERSION } from '../../../package.json'

export type PreviewPlatform = 'macos' | 'windows' | 'linux'

type Args = Record<string, unknown>
type CommandHandler = (args: Args) => unknown

/** Mirrors `ProFeature` in the bindings; every flag starts off, as in Rust. */
const PRO_FEATURES: ProFeature[] = [
  'realtimeTranslation',
  'pdfAiQa',
  'premiumCloudModels',
]

/** A few fonts every desktop OS ships, standing in for the system scan. */
const PREVIEW_FONTS = [
  'Arial',
  'Courier New',
  'Georgia',
  'Helvetica',
  'Times New Roman',
  'Verdana',
]

const NOT_IN_BROWSER = 'not available in browser preview'

/**
 * What a folder picker "chooses", so onboarding's Open/Create flows reach
 * the fake vault. File pickers still behave as cancelled.
 */
export const PREVIEW_FOLDER = '/Users/preview/Documents/Ostralith Sample'

export function detectPlatform(userAgent: string): PreviewPlatform {
  const ua = userAgent.toLowerCase()
  if (ua.includes('mac')) return 'macos'
  if (ua.includes('win')) return 'windows'
  return 'linux'
}

/** Shape of `window.__TAURI_OS_PLUGIN_INTERNALS__`, read synchronously by plugin-os. */
function osInternals(platform: PreviewPlatform) {
  const windows = platform === 'windows'
  return {
    platform,
    os_type: platform,
    family: windows ? 'windows' : 'unix',
    arch: platform === 'macos' ? 'aarch64' : 'x86_64',
    version: { macos: '15.0.0', windows: '10.0.22631', linux: '6.8.0' }[
      platform
    ],
    eol: windows ? '\r\n' : '\n',
    exe_extension: windows ? 'exe' : '',
  }
}

function defaultPolicy(): NetPolicy {
  // Mirrors `NetPolicy::default()` in src-tauri/crates/net/src/policy.rs.
  return { offline: true, allowLocalhost: true, allowedHosts: ['*'] }
}

export interface PreviewHandlerOptions {
  platform: PreviewPlatform
  /** Stands in for Rust's `app.emit(...)`. */
  emitEvent: (event: string, payload: unknown) => unknown
  /** Serves the P1 commands; a fresh one by default. */
  fakeVault?: FakeVault
  /** Stands in for `tauri-plugin-opener`. */
  openUrl?: (url: string) => void
}

/**
 * Builds the IPC mock handler. Session state lives in the closure, so saves
 * survive until the page reloads.
 *
 * Contract with the generated bindings: a `Result<T, E>` command returns `T`
 * on success and *throws the plain `E` value* (never an `Error`) on failure,
 * which the bindings turn into `{ status: 'error', error }`.
 */
export function createPreviewHandler(
  options: PreviewHandlerOptions,
): (cmd: string, args?: InvokeArgs) => unknown {
  const { platform, emitEvent } = options
  const openUrl =
    options.openUrl ??
    ((url: string) => window.open(url, '_blank', 'noopener,noreferrer'))

  let preferences: AppPreferences = defaultPreferences()
  let appState: PersistedAppState = defaultAppState()
  let policy: NetPolicy = defaultPolicy()
  let entitlements: FeatureEntitlement[] = PRO_FEATURES.map((feature) => ({
    feature,
    enabled: false,
  }))
  let activity: RequestRecord[] = []
  let dirty = false
  let autostart = false
  let nextRid = 1
  const bootedAt = Date.now()
  const warned = new Set<string>()

  const updatePolicy = (patch: Partial<NetPolicy>): NetPolicy => {
    policy = { ...policy, ...patch }
    void emitEvent('network:policy-changed', policy)
    return policy
  }

  const handlers: Record<string, CommandHandler> = {
    // --- P1: vault, search, db, backup (see ./fake-vault.ts) ---------------
    ...(options.fakeVault ?? createFakeVault({ emitEvent })).handlers,

    // --- Ostralith commands (src/lib/bindings.ts) ---------------------------
    load_preferences: () => structuredClone(preferences),
    save_preferences: ({ preferences: next }) => {
      preferences = structuredClone(next as AppPreferences)
      return null
    },
    open_preferences_file: () => {
      throw NOT_IN_BROWSER
    },
    load_app_state: () => structuredClone(appState),
    save_app_state: ({ appState: next }) => {
      appState = structuredClone(next as PersistedAppState)
      return null
    },
    set_has_unsaved_changes: ({ dirty: next }) => {
      dirty = Boolean(next)
      return null
    },
    has_unsaved_changes: () => dirty,
    quit_app: () => {
      logger.info('[browser preview] quit_app ignored')
      return null
    },
    log_frontend_error: () => null,
    has_recent_crash: () => null,
    list_crash_reports: () => [],
    get_crash_report: ({ name }) => {
      throw `Crash report ${String(name)} not found`
    },
    clear_crash_reports: () => 0,
    collect_diagnostics: ({ tauriVersion }): DiagnosticsReport => {
      const os = osInternals(platform)
      return {
        appName: 'Ostralith',
        appVersion: APP_VERSION,
        osName: os.os_type,
        osArch: os.arch,
        osVersion: os.version,
        tauriVersion: String(tauriVersion),
        settings: structuredClone(preferences),
        recentCrashReports: [],
        memoryUsageBytes: null,
        uptimeSecs: Math.round((Date.now() - bootedAt) / 1000),
      }
    },
    get_entitlements: () => structuredClone(entitlements),
    set_entitlement: ({ feature, enabled }) => {
      if (!PRO_FEATURES.includes(feature as ProFeature)) {
        throw {
          kind: 'invalidInput',
          message: `Unknown feature ${String(feature)}`,
        } satisfies CoreError
      }
      entitlements = entitlements.map((e) =>
        e.feature === feature ? { ...e, enabled: Boolean(enabled) } : e,
      )
      void emitEvent('entitlements:changed', entitlements)
      return structuredClone(entitlements)
    },
    register_global_shortcut: () => null,
    unregister_global_shortcut: () => null,
    is_global_shortcut_registered: () => false,
    get_network_status: () => structuredClone(policy),
    set_offline_mode: ({ offline }) =>
      structuredClone(updatePolicy({ offline: Boolean(offline) })),
    set_allow_localhost: ({ allow }) =>
      structuredClone(updatePolicy({ allowLocalhost: Boolean(allow) })),
    list_network_activity: () => structuredClone(activity),
    clear_network_activity: () => {
      activity = []
      return null
    },
    show_quick_pane: () => null,
    dismiss_quick_pane: () => null,
    toggle_quick_pane: () => null,
    save_emergency_data: () => null,
    cleanup_old_recovery_files: () => 0,
    list_system_fonts: () => [...PREVIEW_FONTS],
    read_theme_file: () => {
      throw NOT_IN_BROWSER
    },
    check_for_update: () => {
      throw {
        kind: 'featureDisabled',
        feature: 'updater',
        reason: NOT_IN_BROWSER,
      } satisfies CoreError
    },
    install_update: () => {
      throw {
        kind: 'featureDisabled',
        feature: 'updater',
        reason: NOT_IN_BROWSER,
      } satisfies CoreError
    },

    // --- Core plugins -------------------------------------------------------
    'plugin:app|version': () => APP_VERSION,
    'plugin:app|name': () => 'Ostralith',
    'plugin:app|identifier': () => 'com.ostralith.app',
    'plugin:app|tauri_version': () => '2.11.5',
    // Menus: hand back a fresh resource id so `Menu.new()` et al. resolve.
    // Nothing is attached, and `popup` shows nothing.
    'plugin:menu|new': ({ options: opts }) => {
      const rid = nextRid++
      const id = (opts as { id?: string } | undefined)?.id ?? `menu-${rid}`
      return [rid, id]
    },
    'plugin:menu|set_as_app_menu': () => null,
    'plugin:menu|set_as_window_menu': () => null,
    'plugin:menu|popup': () => null,
    'plugin:resources|close': () => null,
    // Window: a browser tab is always visible, never maximised/fullscreen.
    'plugin:window|is_fullscreen': () => false,
    'plugin:window|is_maximized': () => false,
    'plugin:window|is_minimized': () => false,
    'plugin:window|is_visible': () => true,
    'plugin:window|is_focused': () => document.hasFocus(),
    'plugin:window|show': () => null,
    'plugin:window|hide': () => null,
    'plugin:window|set_focus': () => null,
    'plugin:window|unminimize': () => null,
    'plugin:window|minimize': () => null,
    'plugin:window|toggle_maximize': () => null,
    'plugin:window|maximize': () => null,
    'plugin:window|unmaximize': () => null,
    'plugin:window|set_fullscreen': () => null,
    'plugin:window|close': () => null,
    'plugin:window|start_dragging': () => null,
    'plugin:window|set_effects': () => null,
    'plugin:window|clear_effects': () => null,

    // --- Third-party plugins ------------------------------------------------
    'plugin:log|log': () => null,
    'plugin:os|locale': () => navigator.language,
    'plugin:os|hostname': () => 'localhost',
    'plugin:autostart|is_enabled': () => autostart,
    'plugin:autostart|enable': () => {
      autostart = true
      return null
    },
    'plugin:autostart|disable': () => {
      autostart = false
      return null
    },
    'plugin:deep-link|register': () => null,
    'plugin:deep-link|unregister': () => null,
    'plugin:deep-link|is_registered': () => false,
    'plugin:deep-link|get_current': () => null,
    // A folder picker returns PREVIEW_FOLDER; a file picker is cancelled.
    'plugin:dialog|open': ({ options: opts }) =>
      (opts as { directory?: boolean } | undefined)?.directory
        ? PREVIEW_FOLDER
        : null,
    'plugin:dialog|save': () => null,
    'plugin:opener|open_url': ({ url }) => {
      openUrl(String(url))
      return null
    },
    'plugin:opener|open_path': () => null,
    'plugin:opener|reveal_item_in_dir': () => null,
  }

  return (cmd, args) => {
    const handler = handlers[cmd]
    // Every command this app calls takes named arguments, never raw bytes.
    if (handler) return handler((args ?? {}) as Args)
    if (!warned.has(cmd)) {
      warned.add(cmd)
      logger.warn(`[browser preview] unmocked command "${cmd}" returned null`)
    }
    return null
  }
}

function showBanner(): void {
  const pill = document.createElement('div')
  pill.textContent = 'Browser preview — native features are mocked'
  pill.title = 'Click to hide'
  pill.setAttribute('role', 'status')
  pill.dataset.browserPreview = ''
  Object.assign(pill.style, {
    position: 'fixed',
    left: '50%',
    bottom: '8px',
    transform: 'translateX(-50%)',
    zIndex: '2147483647',
    padding: '2px 10px',
    borderRadius: '9999px',
    font: '500 11px/18px system-ui, sans-serif',
    color: 'var(--muted-foreground, #555)',
    background: 'var(--muted, #eee)',
    border: '1px solid var(--border, #ccc)',
    opacity: '0.85',
    cursor: 'pointer',
    userSelect: 'none',
  } satisfies Partial<CSSStyleDeclaration>)
  pill.addEventListener('click', () => pill.remove())
  document.body.append(pill)
}

/**
 * Installs the mocks for the window labelled `windowLabel`. Must run before
 * anything touches `@tauri-apps/api/window` or `@tauri-apps/plugin-os`.
 */
export function installBrowserPreview(windowLabel = 'main'): void {
  const platform = detectPlatform(navigator.userAgent)
  ;(
    window as unknown as Record<string, unknown>
  ).__TAURI_OS_PLUGIN_INTERNALS__ = osInternals(platform)
  mockWindows(windowLabel)
  const fakeVault = createFakeVault({ emitEvent: emit })
  mockIPC(createPreviewHandler({ platform, emitEvent: emit, fakeVault }), {
    shouldMockEvents: true,
  })
  // Console hook for exercising external-change handling (reload prompts,
  // write conflicts), which nothing in the browser can trigger otherwise.
  ;(window as unknown as Record<string, unknown>).__OSTRALITH_PREVIEW__ = {
    externalEdit: fakeVault.externalEdit,
  }
  showBanner()
  logger.info(
    `[browser preview] Tauri IPC mocked (platform: ${platform}). ` +
      'window.__OSTRALITH_PREVIEW__.externalEdit(path, content | null) ' +
      'simulates an edit made outside the app.',
  )
}
