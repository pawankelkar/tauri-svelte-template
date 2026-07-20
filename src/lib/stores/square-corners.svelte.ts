import { getCurrentWindow } from '@tauri-apps/api/window'
import { platform } from '@tauri-apps/plugin-os'
import { setSquareCorners } from '$lib/stores/ui.svelte'

export function initSquareCorners(): () => void {
  if (platform() === 'macos') return () => {}

  const win = getCurrentWindow()
  let cancelled = false

  const update = async () => {
    const isFullscreen = await win.isFullscreen()
    if (cancelled) return
    setSquareCorners(isFullscreen)
  }

  void update()
  const unlistenPromise = win.onResized(() => void update())

  return () => {
    cancelled = true
    void unlistenPromise.then((fn) => fn())
  }
}
