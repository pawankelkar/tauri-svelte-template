import { mount } from 'svelte'
import { isTauri } from '@tauri-apps/api/core'
import QuickPaneApp from '$lib/components/quick-pane/QuickPaneApp.svelte'
import { paintFromHint } from '$lib/theme/paint-hint'
import '$lib/i18n/config'
import './quick-pane.css'

async function bootstrap(): Promise<void> {
  // Dev-only browser preview (see src/main.ts): /quick-pane.html opened in a
  // plain browser gets the same IPC mocks, under the pane's window label.
  if (import.meta.env.DEV && !isTauri()) {
    const preview = await import('$lib/dev/browser-preview')
    preview.installBrowserPreview('quick-pane')
  }

  // The pane is a second webview with its own JS context — it shares nothing
  // with the main window except the origin, and therefore `localStorage`.
  // That is enough for the theme hint to paint it correctly before first
  // frame, the same way `main.ts` does.
  paintFromHint()

  mount(QuickPaneApp, {
    target: document.getElementById('quick-pane-app')!,
  })
}

void bootstrap()
