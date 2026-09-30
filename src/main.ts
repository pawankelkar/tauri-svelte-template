import { mount } from 'svelte'
import { isTauri } from '@tauri-apps/api/core'
import App from './App.svelte'
import { paintFromHint } from '$lib/theme/paint-hint'
import '$lib/i18n/config'

async function bootstrap(): Promise<void> {
  // Dev-only: in a plain browser there is no Tauri IPC, so mock it before
  // anything touches the window or plugin APIs. The whole branch — and the
  // module it imports — is dropped from production builds.
  if (import.meta.env.DEV && !isTauri()) {
    const { installBrowserPreview } = await import('$lib/dev/browser-preview')
    installBrowserPreview('main')
  }

  paintFromHint()

  mount(App, { target: document.getElementById('app')! })
}

void bootstrap()
