// Native window translucency behind the app canvas, driven by the
// `windowEffects` preference. The main window is created `transparent: true`
// permanently (tauri.conf.json) because transparency is a creation-time flag;
// CSS keeps the app visually opaque while the preference is off, so the only
// runtime switch needed is setEffects/clearEffects plus the
// `data-window-effects` attribute that gates the translucent body background.
//
// Tauri does NOT auto-fallback across the effects list on Windows — it applies
// the first Windows-flavored effect blindly — so exactly one effect is picked
// here after checking the build number.

import { getCurrentWindow, Effect } from '@tauri-apps/api/window'
import { platform, version } from '@tauri-apps/plugin-os'

/** Mica needs Windows 11 (build 22000+); older builds get Acrylic. */
export function pickWindowsEffect(build: number): Effect {
  return build >= 22000 ? Effect.Mica : Effect.Acrylic
}

/**
 * Windows 11 still reports major version 10 — the build number is the third
 * segment of the `plugin-os` version string ("10.0.22631").
 */
export function parseWindowsBuild(osVersion: string): number {
  const build = Number(osVersion.split('.')[2])
  return Number.isFinite(build) ? build : 0
}

/**
 * Applies or clears the native effect for the current window. Best-effort:
 * a failed IPC call must never block startup or the toggle, so every failure
 * is swallowed. Linux is a no-op (no effect support in Tauri).
 */
export async function applyWindowEffects(enabled: boolean): Promise<void> {
  try {
    const win = getCurrentWindow()
    if (!enabled) {
      await win.clearEffects()
      return
    }
    const os = platform()
    if (os === 'windows') {
      await win.setEffects({
        effects: [pickWindowsEffect(parseWindowsBuild(version()))],
      })
    } else if (os === 'macos') {
      await win.setEffects({ effects: [Effect.UnderWindowBackground] })
    }
  } catch {
    // Best-effort — the app stays opaque, which is always a safe state.
  }
}
