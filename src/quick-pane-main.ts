import { mount } from 'svelte'
import QuickPaneApp from '$lib/components/quick-pane/QuickPaneApp.svelte'
import { paintFromHint } from '$lib/theme/paint-hint'
import '$lib/i18n/config'
import './quick-pane.css'

// The pane is a second webview with its own JS context — it shares nothing
// with the main window except the origin, and therefore `localStorage`. That
// is enough for the theme hint to paint it correctly before first frame, the
// same way `main.ts` does.
paintFromHint()

const app = mount(QuickPaneApp, {
  target: document.getElementById('quick-pane-app')!,
})
export default app
