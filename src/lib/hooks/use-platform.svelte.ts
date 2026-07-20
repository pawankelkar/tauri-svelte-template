import { platform, type Platform } from '@tauri-apps/plugin-os'

export type AppPlatform = 'macos' | 'windows' | 'linux'

let cached: AppPlatform | null = null

function map(p: Platform): AppPlatform {
  if (p === 'macos') return 'macos'
  if (p === 'windows') return 'windows'
  return 'linux'
}

export function getPlatform(): AppPlatform {
  if (cached === null) {
    try {
      cached = map(platform())
    } catch {
      cached = 'macos'
    }
  }
  return cached
}

export function __resetPlatformCache(): void {
  cached = null
}
