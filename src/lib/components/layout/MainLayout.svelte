<script lang="ts">
  import type { Snippet } from 'svelte'
  import * as Resizable from '$lib/components/ui/resizable'
  import LeftSideBar from './LeftSideBar.svelte'
  import RightSideBar from './RightSideBar.svelte'
  import {
    isLeftSidebarVisible,
    isRightSidebarVisible,
  } from '$lib/stores/ui.svelte'
  import { cn } from '$lib/utils'

  let {
    left,
    right,
    children,
  }: { left?: Snippet; right?: Snippet; children: Snippet } = $props()

  /** Panel sizes are percentages of the group's width. */
  const LAYOUT = {
    leftSidebar: { default: 20, min: 15, max: 40 },
    rightSidebar: { default: 20, min: 15, max: 40 },
    main: { min: 30 },
  } as const
</script>

<!--
  Hidden sidebars get `hidden` (display: none) rather than being unmounted.

  Paneforge sizes panes with `flex-basis: 0` + `flex-grow: <percentage>` and
  never sets `display` inline, so a hidden pane drops out of flex layout and the
  remaining panes renormalise to fill the width — no gap, no re-render. Its
  entry in paneforge's internal layout array is untouched, so showing it again
  restores the exact width the user dragged it to.

  The resize handle next to a hidden pane must be hidden too, or a dead drag
  handle is left stranded at the window edge.
-->
<Resizable.PaneGroup direction="horizontal" class="h-full w-full">
  <Resizable.Pane
    defaultSize={LAYOUT.leftSidebar.default}
    minSize={LAYOUT.leftSidebar.min}
    maxSize={LAYOUT.leftSidebar.max}
    class={cn(!isLeftSidebarVisible() && 'hidden')}
  >
    <LeftSideBar>{@render left?.()}</LeftSideBar>
  </Resizable.Pane>
  <Resizable.Handle class={cn(!isLeftSidebarVisible() && 'hidden')} />

  <Resizable.Pane minSize={LAYOUT.main.min}>
    {@render children()}
  </Resizable.Pane>

  <Resizable.Handle class={cn(!isRightSidebarVisible() && 'hidden')} />
  <Resizable.Pane
    defaultSize={LAYOUT.rightSidebar.default}
    minSize={LAYOUT.rightSidebar.min}
    maxSize={LAYOUT.rightSidebar.max}
    class={cn(!isRightSidebarVisible() && 'hidden')}
  >
    <RightSideBar>{@render right?.()}</RightSideBar>
  </Resizable.Pane>
</Resizable.PaneGroup>
