<script lang="ts">
  import { onMount } from 'svelte'
  import { emit, listen } from '@tauri-apps/api/event'
  import { getCurrentWindow } from '@tauri-apps/api/window'
  import { commands, unwrapResult } from '$lib/tauri-bindings'
  import { paintFromHint } from '$lib/theme/paint-hint'
  import { QUICK_PANE_SUBMIT_EVENT } from '$lib/quick-pane/events'
  import { t } from '$lib/i18n/t.svelte'
  import { textInputContextMenu } from '$lib/actions/context-menu-actions'
  import { logger } from '$lib/logger'

  /**
   * Root of the Quick Pane window.
   *
   * This component runs in its own webview, so none of the main window's stores
   * are reachable — everything it needs arrives over Tauri events or via
   * `localStorage`, which the two windows share by virtue of a common origin.
   */

  let text = $state('')
  let input = $state<HTMLInputElement | null>(null)

  function dismiss(): void {
    // Always the command, never `window.hide()`: the Rust side owns the
    // visibility guard, so every dismissal path behaves identically.
    void (async () => {
      try {
        unwrapResult(await commands.dismissQuickPane())
      } catch (e) {
        // The pane is stuck on screen at this point; nothing useful to do
        // beyond leaving a trail, so it must not also throw.
        logger.warn('Dismissing the Quick Pane failed', e)
      }
    })()
  }

  function submit(): void {
    const entry = text.trim()
    text = ''
    if (entry) void emit(QUICK_PANE_SUBMIT_EVENT, { text: entry })
    dismiss()
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      // Without preventDefault, macOS plays the system alert sound for an
      // Escape the webview did not consume.
      event.preventDefault()
      text = ''
      dismiss()
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      submit()
    }
  }

  onMount(() => {
    const window = getCurrentWindow()

    const unlistenTheme = listen('theme-changed', () => {
      paintFromHint()
    })

    const unlistenFocus = window.onFocusChanged(({ payload: focused }) => {
      if (focused) {
        // The pane may have been hidden while the user changed the theme, and
        // a hidden window gets no repaint — so re-read the hint on every show.
        paintFromHint()
        input?.focus()
        input?.select()
        return
      }
      dismiss()
    })

    return () => {
      void unlistenTheme.then((fn) => fn())
      void unlistenFocus.then((fn) => fn())
    }
  })

  $effect(() => {
    input?.focus()
  })
</script>

<!--
  The card, not the window, draws the pane. The window itself is transparent
  and undecorated (see quick-pane.css), which is what lets the rounded corners
  and the shadow read as a floating panel rather than a rectangle.
-->
<div class="flex h-full w-full items-center p-2">
  <div
    class="bg-popover text-popover-foreground flex w-full items-center gap-3 rounded-xl border px-4 py-3 shadow-2xl"
  >
    <input
      bind:this={input}
      bind:value={text}
      class="placeholder:text-muted-foreground flex-1 bg-transparent text-base outline-none"
      placeholder={t('quickPane.placeholder')}
      onkeydown={handleKeydown}
      spellcheck="false"
      autocomplete="off"
      use:textInputContextMenu
    />
    <kbd
      class="bg-muted text-muted-foreground shrink-0 rounded px-1.5 py-0.5 font-mono text-xs"
    >
      {t('quickPane.submitHint')}
    </kbd>
  </div>
</div>
