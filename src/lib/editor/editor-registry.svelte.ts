/**
 * Mounted note editors, keyed by tab id.
 *
 * Commands, the outline and the backlinks panel live in the main bundle,
 * while CodeMirror only loads with the note view. This registry is the seam:
 * each mounted `NoteEditor` registers a small handle, and everything else
 * talks to the handle — never to CodeMirror directly — so importing this
 * module pulls in no editor code.
 */

/** Where to put the caret in a note: a 0-based line, or a heading. */
export type RevealTarget = { line: number } | { heading: string }

export interface EditorHandle {
  focus(): void
  /** Scrolls to and places the caret on the target. */
  reveal(target: RevealTarget): void
  toggleBold(): void
  toggleItalic(): void
  /** Opens CodeMirror's in-note find panel. */
  openFind(): void
  /** The text of the main selection (empty when collapsed). */
  selectedText(): string
}

// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never rendered
const _handles = new Map<string, EditorHandle>()
/** Reveals asked for before the tab's editor was mounted (or loaded). */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never rendered
const _pending = new Map<string, RevealTarget>()

/** The caret line of each editor, for the outline's current heading. */
let _cursorLines = $state<Record<string, number>>({})

export function registerEditor(
  tabId: string,
  handle: EditorHandle,
): () => void {
  _handles.set(tabId, handle)
  const pending = _pending.get(tabId)
  if (pending) {
    _pending.delete(tabId)
    handle.reveal(pending)
  }
  return () => {
    if (_handles.get(tabId) === handle) _handles.delete(tabId)
  }
}

export function getEditor(tabId: string | undefined): EditorHandle | undefined {
  return tabId ? _handles.get(tabId) : undefined
}

/**
 * Reveals `target` in the tab's editor now, or as soon as it mounts — the
 * common case, since opening a note and asking for a heading happen in the
 * same tick, before the view has even loaded.
 */
export function revealInTab(tabId: string, target: RevealTarget): void {
  const handle = _handles.get(tabId)
  if (handle) handle.reveal(target)
  else _pending.set(tabId, target)
}

export function setCursorLine(tabId: string, line: number): void {
  if (_cursorLines[tabId] !== line) _cursorLines[tabId] = line
}

export function getCursorLine(tabId: string | undefined): number | undefined {
  return tabId ? _cursorLines[tabId] : undefined
}

export function __resetEditorRegistryForTests(): void {
  _handles.clear()
  _pending.clear()
  _cursorLines = {}
}
