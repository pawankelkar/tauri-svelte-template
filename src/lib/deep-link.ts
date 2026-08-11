import { register } from '@tauri-apps/plugin-deep-link'
import { getPlatform } from '$lib/hooks/use-platform.svelte'
import { logger } from '$lib/logger'

/**
 * The custom URL scheme, mirroring `plugins.deep-link.desktop.schemes` in
 * `src-tauri/tauri.conf.json` (the `/setup` skill renames both together).
 */
export const DEEP_LINK_SCHEME = 'tauri-app'

/**
 * Dev-only scheme registration. Bundled installers register the scheme at
 * install time from the config; `pnpm tauri dev` never runs an installer, so
 * without this a dev build ignores `tauri-app://` URLs. Runtime registration
 * is only supported on Windows/Linux — macOS resolves schemes from the app
 * bundle's Info.plist, so dev-testing deep links there needs a built app.
 */
export async function registerDeepLinkSchemeInDev(): Promise<void> {
  if (!import.meta.env.DEV || getPlatform() === 'macos') return
  try {
    await register(DEEP_LINK_SCHEME)
  } catch (e) {
    logger.warn('Dev deep-link registration failed', e)
  }
}
