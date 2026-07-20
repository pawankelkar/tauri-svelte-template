import { getCurrentWindow } from '@tauri-apps/api/window'
import { platform } from '@tauri-apps/plugin-os'

export function initSquareCorners(): () => void {
  if (platform() === 'macos') return () => {}

  const win = getCurrentWindow()
  let cancelled = false

  const update = async () => {
    const isFullscreen = await win.isFullscreen()
    if (cancelled) return
    document.documentElement.classList.toggle('square-corners', isFullscreen)
  }

  void update()
  const unlistenPromise = win.onResized(() => void update())

  return () => {
    cancelled = true
    void unlistenPromise.then((fn) => fn())
  }
}
