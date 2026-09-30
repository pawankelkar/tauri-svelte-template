import {
  revealInTab,
  type RevealTarget,
} from '$lib/editor/editor-registry.svelte'
import { formatUri, noteTitleFromPath, parseUri } from './uri'
import { findTabByUri, openTab, type Tab } from './tabs.svelte'

export const NOTE_VIEW_KIND = 'note'

export interface OpenNoteOptions {
  /**
   * Open in the group's preview slot (replaced by the next preview open)
   * rather than as a kept tab. Single clicks in lists use this.
   */
  preview?: boolean
  /** Open without focusing. */
  background?: boolean
  /** Scroll to a line or heading once the note is on screen. */
  reveal?: RevealTarget
}

/** The canonical tab URI for a note: no heading, so one note is one tab. */
export function noteUri(path: string): string {
  return formatUri({ kind: 'note', path })
}

/** The vault-relative path a note tab shows, or `null` for other tabs. */
export function notePathOfTab(tab: Tab | undefined): string | null {
  if (!tab || tab.kind !== NOTE_VIEW_KIND) return null
  const target = parseUri(tab.uri)
  return target?.kind === 'note' ? target.path : null
}

export function findNoteTab(path: string): Tab | undefined {
  return findTabByUri(noteUri(path))
}

/** Opens (or focuses) the note's tab. Returns the tab id, or `null`. */
export function openNote(
  path: string,
  options: OpenNoteOptions = {},
): string | null {
  const id = openTab(
    {
      kind: NOTE_VIEW_KIND,
      uri: noteUri(path),
      title: noteTitleFromPath(path),
    },
    { preview: options.preview, background: options.background },
  )
  if (id && options.reveal) revealInTab(id, options.reveal)
  return id
}
