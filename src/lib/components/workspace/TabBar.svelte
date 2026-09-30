<script lang="ts">
  import XIcon from '@lucide/svelte/icons/x'
  import PinIcon from '@lucide/svelte/icons/pin'
  import { showContextMenu } from '$lib/context-menu'
  import { logger } from '$lib/logger'
  import { cn } from '$lib/utils'
  import { t } from '$lib/i18n/t.svelte'
  import {
    activateTab,
    closeOtherTabs,
    closeTab,
    getGroupTabs,
    keepTab,
    moveTab,
    togglePinTab,
    unpinTab,
    type EditorGroup,
    type Tab,
  } from '$lib/workspace/tabs.svelte'

  let { group, panelId }: { group: EditorGroup; panelId: string } = $props()

  const tabs = $derived(getGroupTabs(group.id))

  let scroller = $state<HTMLElement>()
  const tabEls: Record<string, HTMLElement> = $state({})
  const itemEls: Record<string, HTMLElement> = $state({})

  // Keep the active tab in view however it became active (keyboard,
  // command, deep link).
  $effect(() => {
    const id = group.activeTabId
    if (!id) return
    itemEls[id]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  })

  // A plain mouse wheel scrolls vertically; turn it sideways over the strip.
  // Registered by hand because Svelte's `onwheel` is passive and could not
  // cancel the page scroll.
  $effect(() => {
    const el = scroller
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
      if (el.scrollWidth <= el.clientWidth) return
      el.scrollLeft += e.deltaY
      e.preventDefault()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

  function focusTab(id: string): void {
    activateTab(id)
    tabEls[id]?.focus()
  }

  /** WAI-ARIA tabs pattern: arrows move focus and activate (automatic). */
  function onTabKeydown(e: KeyboardEvent, index: number, tab: Tab): void {
    const count = tabs.length
    const rtl = document.documentElement.dir === 'rtl'
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight'
    const back = rtl ? 'ArrowRight' : 'ArrowLeft'
    let target: number
    switch (e.key) {
      case forward:
        target = (index + 1) % count
        break
      case back:
        target = (index - 1 + count) % count
        break
      case 'Home':
        target = 0
        break
      case 'End':
        target = count - 1
        break
      case 'Delete':
        e.preventDefault()
        void closeTab(tab.id)
        return
      default:
        return
    }
    e.preventDefault()
    const next = tabs[target]
    if (next) focusTab(next.id)
  }

  function onAuxClick(e: MouseEvent, tab: Tab): void {
    if (e.button !== 1) return
    e.preventDefault()
    void closeTab(tab.id)
  }

  // Stops the middle button from entering autoscroll mode.
  function onMouseDown(e: MouseEvent): void {
    if (e.button === 1) e.preventDefault()
  }

  function onContextMenu(e: MouseEvent, tab: Tab): void {
    e.preventDefault()
    const hasOthers = tabs.some((other) => other.id !== tab.id && !other.pinned)
    showContextMenu([
      {
        id: 'tab-close',
        labelKey: 'commands.tab.close',
        action: () => void closeTab(tab.id),
      },
      {
        id: 'tab-close-others',
        labelKey: 'commands.tab.closeOthers',
        action: () => void closeOtherTabs(tab.id),
        disabled: !hasOthers,
      },
      { separator: true },
      {
        id: 'tab-toggle-pin',
        labelKey: tab.pinned ? 'commands.tab.unpin' : 'commands.tab.pin',
        action: () => togglePinTab(tab.id),
      },
      { separator: true },
      {
        id: 'tab-copy-link',
        labelKey: 'workspace.tabs.copyLink',
        action: () => void navigator.clipboard.writeText(tab.uri),
      },
    ]).catch((error: unknown) => {
      logger.warn('Showing the tab context menu failed', error)
    })
  }

  // --- Drag to reorder ------------------------------------------------------
  // Pointer events rather than HTML5 drag-and-drop: with Tauri's
  // `dragDropEnabled` on (needed for file drops), WebView2 never delivers
  // in-page HTML5 drag events on Windows.

  const DRAG_THRESHOLD_PX = 5

  interface DragState {
    pointerId: number
    from: number
    startX: number
    active: boolean
    /** Insertion slot, 0..tabs.length. */
    slot: number
  }

  let drag = $state<DragState | null>(null)
  let suppressClick = false

  function slotAt(x: number): number {
    for (let i = 0; i < tabs.length; i++) {
      const el = itemEls[tabs[i]!.id]
      if (!el) continue
      const rect = el.getBoundingClientRect()
      if (x < rect.left + rect.width / 2) return i
    }
    return tabs.length
  }

  function onPointerDown(e: PointerEvent, index: number): void {
    if (e.button !== 0) return
    drag = {
      pointerId: e.pointerId,
      from: index,
      startX: e.clientX,
      active: false,
      slot: index,
    }
  }

  function onPointerMove(e: PointerEvent): void {
    if (!drag || e.pointerId !== drag.pointerId) return
    if (!drag.active) {
      if (Math.abs(e.clientX - drag.startX) < DRAG_THRESHOLD_PX) return
      drag.active = true
      ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    }
    drag.slot = slotAt(e.clientX)
  }

  function onPointerUp(e: PointerEvent): void {
    if (!drag || e.pointerId !== drag.pointerId) return
    if (drag.active) {
      suppressClick = true
      const { from, slot } = drag
      // A slot to the right of the source shifts left once it is removed.
      moveTab(from, slot > from ? slot - 1 : slot, group.id)
    }
    drag = null
  }

  function onTabClick(tab: Tab): void {
    if (suppressClick) {
      suppressClick = false
      return
    }
    activateTab(tab.id)
  }

  const trailButton =
    'text-muted-foreground hover:bg-foreground/10 hover:text-foreground flex size-5 items-center justify-center rounded-sm transition-colors'
</script>

<!--
  The strip's bottom rule is an inset shadow rather than a border, so the
  active tab (painted with the panel's background) visually opens into the
  panel below it.
-->
<div
  bind:this={scroller}
  role="tablist"
  aria-label={t('workspace.tabs.label')}
  aria-orientation="horizontal"
  class="bg-muted/40 flex h-9 shrink-0 items-stretch overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_var(--color-border)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
>
  {#each tabs as tab, index (tab.id)}
    {@const active = tab.id === group.activeTabId}
    {@const dropBefore = drag?.active && drag.slot === index}
    {@const dropAfter =
      drag?.active && drag.slot === tabs.length && index === tabs.length - 1}
    <div
      bind:this={itemEls[tab.id]}
      role="presentation"
      class={cn(
        'group/tab border-border relative flex max-w-56 min-w-24 shrink-0 items-center border-r text-sm select-none',
        active
          ? 'bg-background text-foreground'
          : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
        drag?.active && drag.from === index && 'opacity-60',
      )}
      onauxclick={(e) => onAuxClick(e, tab)}
      onmousedown={onMouseDown}
      oncontextmenu={(e) => onContextMenu(e, tab)}
    >
      {#if active}
        <span
          class="bg-primary absolute inset-x-0 top-0 h-0.5"
          aria-hidden="true"
        ></span>
      {/if}
      {#if dropBefore}
        <span
          class="bg-primary absolute inset-y-1 -left-px w-0.5 rounded-full"
          aria-hidden="true"
        ></span>
      {/if}
      {#if dropAfter}
        <span
          class="bg-primary absolute inset-y-1 -right-px w-0.5 rounded-full"
          aria-hidden="true"
        ></span>
      {/if}

      <button
        bind:this={tabEls[tab.id]}
        type="button"
        role="tab"
        id="workspace-tab-{tab.id}"
        aria-selected={active}
        aria-controls={panelId}
        tabindex={active ? 0 : -1}
        title={tab.title}
        class="focus-visible:ring-ring/50 flex h-full min-w-0 flex-1 items-center gap-1.5 pr-1 pl-3 outline-none focus-visible:ring-2 focus-visible:ring-inset"
        onclick={() => onTabClick(tab)}
        ondblclick={() => keepTab(tab.id)}
        onkeydown={(e) => onTabKeydown(e, index, tab)}
        onpointerdown={(e) => onPointerDown(e, index)}
        onpointermove={onPointerMove}
        onpointerup={onPointerUp}
        onpointercancel={() => (drag = null)}
      >
        <span class={cn('truncate', tab.preview && 'italic')}>{tab.title}</span>
        {#if tab.dirty}
          <span class="sr-only">{t('workspace.tabs.unsaved')}</span>
          {#if tab.pinned}
            <span
              class="bg-foreground/60 size-2 shrink-0 rounded-full"
              aria-hidden="true"
            ></span>
          {/if}
        {/if}
      </button>

      <!-- Kept out of the tab order: one stop per tab, per the tabs pattern.
           Keyboard users close with Delete or the close-tab command. -->
      <div class="mr-1.5 flex size-5 shrink-0 items-center justify-center">
        {#if tab.pinned}
          <button
            type="button"
            tabindex="-1"
            class={trailButton}
            aria-label={t('workspace.tabs.unpinTab', { title: tab.title })}
            title={t('commands.tab.unpin')}
            onclick={() => unpinTab(tab.id)}
          >
            <PinIcon class="size-3" />
          </button>
        {:else}
          {#if tab.dirty}
            <span
              class="bg-foreground/60 size-2 rounded-full group-focus-within/tab:hidden group-hover/tab:hidden"
              aria-hidden="true"
            ></span>
          {/if}
          <button
            type="button"
            tabindex="-1"
            class={cn(
              trailButton,
              tab.dirty
                ? 'hidden group-focus-within/tab:flex group-hover/tab:flex'
                : !active &&
                    'opacity-0 group-focus-within/tab:opacity-100 group-hover/tab:opacity-100',
            )}
            aria-label={t('workspace.tabs.closeTab', { title: tab.title })}
            title={t('commands.tab.close')}
            onclick={() => void closeTab(tab.id)}
          >
            <XIcon class="size-3.5" />
          </button>
        {/if}
      </div>
    </div>
  {/each}
</div>
