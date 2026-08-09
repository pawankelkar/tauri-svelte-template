<script lang="ts">
  import type { Snippet } from 'svelte'
  import { getCurrentWindow } from '@tauri-apps/api/window'
  import {
    macosClosePath,
    macosMinimizePath,
    macosFullscreenPath,
    macosMaximizePath,
  } from './WindowControlIcons'
  import TitleBarShell from './TitleBarShell.svelte'

  let {
    title,
    leftActions,
    rightActions,
  }: {
    title?: string
    leftActions?: Snippet
    rightActions?: Snippet
  } = $props()

  const appWindow = getCurrentWindow()
  let isAltKeyPressed = $state(false)
  let isHovering = $state(false)
  let isWindowFocused = $state(true)

  $effect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Alt') isAltKeyPressed = true
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') isAltKeyPressed = false
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    const p = appWindow.onFocusChanged(({ payload: focused }) => {
      isWindowFocused = focused
    })

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      p.then((unlisten) => unlisten())
    }
  })

  async function handleClose() {
    await appWindow.close()
  }

  async function handleMinimize() {
    await appWindow.minimize()
  }

  async function handleMaximizeOrFullscreen() {
    const isFullscreen = await appWindow.isFullscreen()
    if (isFullscreen) {
      await appWindow.setFullscreen(false)
    } else if (isAltKeyPressed) {
      await appWindow.toggleMaximize()
    } else {
      await appWindow.setFullscreen(true)
    }
  }

  const focusedClose = 'border-black/[.12] bg-[#ff544d]'
  const focusedMinimize = 'border-black/[.12] bg-[#ffbd2e]'
  const focusedGreen = 'border-black/[.12] bg-[#28c93f]'
  const unfocused = 'border-gray-400/20 bg-gray-400'
  const btnBase =
    'group flex h-3 w-3 cursor-default items-center justify-center rounded-full border text-center text-black/60 dark:border-none'
</script>

<TitleBarShell {title}>
  <!-- drag-region="false" + self-stretch: see WindowsTitleBar.svelte. -->
  {#snippet leading()}
    <div data-tauri-drag-region="false" class="flex items-center self-stretch">
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="flex items-center gap-2 px-3 text-black active:text-black dark:text-black"
        onmouseenter={() => (isHovering = true)}
        onmouseleave={() => (isHovering = false)}
      >
        <button
          type="button"
          onclick={handleClose}
          aria-label="Close window"
          class="{btnBase} hover:bg-[#ff544d] hover:border-black/[.12] active:bg-[#bf403a] {isWindowFocused
            ? focusedClose
            : unfocused}"
        >
          <div class="flex h-3 w-3 items-center justify-center">
            {#if isHovering}
              <svg
                width="6"
                height="6"
                viewBox="0 0 16 18"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d={macosClosePath}
                  fill="currentColor"
                  class="opacity-60"
                />
              </svg>
            {/if}
          </div>
        </button>
        <button
          type="button"
          onclick={handleMinimize}
          aria-label="Minimize window"
          class="{btnBase} hover:bg-[#ffbd2e] hover:border-black/[.12] active:bg-[#bf9122] {isWindowFocused
            ? focusedMinimize
            : unfocused}"
        >
          <div class="flex h-3 w-3 items-center justify-center">
            {#if isHovering}
              <svg
                width="8"
                height="8"
                viewBox="0 0 17 6"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  fill-rule="evenodd"
                  clip-rule="evenodd"
                  d={macosMinimizePath}
                  fill="currentColor"
                  class="opacity-60"
                />
              </svg>
            {/if}
          </div>
        </button>
        <button
          type="button"
          onclick={handleMaximizeOrFullscreen}
          aria-label={isAltKeyPressed ? 'Maximize window' : 'Enter fullscreen'}
          class="{btnBase} hover:bg-[#28c93f] hover:border-black/[.12] active:bg-[#1e9930] {isWindowFocused
            ? focusedGreen
            : unfocused}"
        >
          <div class="flex h-3 w-3 items-center justify-center">
            {#if isHovering}
              {#if isAltKeyPressed}
                <svg
                  width="8"
                  height="8"
                  viewBox="0 0 17 16"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    fill-rule="evenodd"
                    clip-rule="evenodd"
                    d={macosMaximizePath}
                    fill="currentColor"
                    class="opacity-60"
                  />
                </svg>
              {:else}
                <svg
                  width="6"
                  height="6"
                  viewBox="0 0 15 15"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    fill-rule="evenodd"
                    clip-rule="evenodd"
                    d={macosFullscreenPath}
                    fill="currentColor"
                    class="opacity-60"
                  />
                </svg>
              {/if}
            {/if}
          </div>
        </button>
      </div>
      {#if leftActions}
        {@render leftActions()}
      {/if}
    </div>
  {/snippet}

  {#snippet trailing()}
    <div
      data-tauri-drag-region="false"
      class="flex items-center self-stretch pr-2"
    >
      {#if rightActions}
        {@render rightActions()}
      {/if}
    </div>
  {/snippet}
</TitleBarShell>
