/**
 * Which activity the left sidebar shows (files or search), which panel the
 * right one shows (outline or backlinks), and the search query, so a command or deep link can jump straight to a search. Kept in
 * memory: a fresh launch starts on the file tree.
 */
import { setLeftSidebarVisible } from './ui.svelte'

export type LeftActivity = 'files' | 'search'
export type RightPanel = 'outline' | 'backlinks'

let _activity = $state<LeftActivity>('files')
let _rightPanel = $state<RightPanel>('outline')
let _query = $state('')
/** Bumped to ask the search field to take focus. */
let _focusSeq = $state(0)

export function getLeftActivity(): LeftActivity {
  return _activity
}

export function setLeftActivity(activity: LeftActivity): void {
  _activity = activity
}

export function getRightPanel(): RightPanel {
  return _rightPanel
}

export function setRightPanel(panel: RightPanel): void {
  _rightPanel = panel
}

export function getSearchQuery(): string {
  return _query
}

export function setSearchQuery(query: string): void {
  _query = query
}

export function getSearchFocusRequest(): number {
  return _focusSeq
}

/**
 * Shows the search activity (opening the sidebar if hidden) and focuses its
 * field, optionally with a new query.
 */
export function showSearch(query?: string): void {
  setLeftSidebarVisible(true)
  _activity = 'search'
  if (query !== undefined) _query = query
  _focusSeq++
}

export function __resetSidebarForTests(): void {
  _activity = 'files'
  _rightPanel = 'outline'
  _query = ''
  _focusSeq = 0
}
