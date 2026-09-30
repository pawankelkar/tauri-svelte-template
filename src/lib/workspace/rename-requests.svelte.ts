/**
 * "Start renaming" requests from commands (F2, the context menu) to the
 * component that owns the inline editor: a note view's title or a file
 * tree row. Each request carries a sequence number so asking twice for the
 * same target still fires.
 */

export interface RenameRequest {
  /** A tab id (`'title'`) or a vault-relative path (`'tree'`). */
  target: string
  seq: number
}

let _title = $state<RenameRequest | null>(null)
let _tree = $state<RenameRequest | null>(null)
let _seq = 0

/** Asks the note view in `tabId` to turn its title into a text field. */
export function requestTitleRename(tabId: string): void {
  _title = { target: tabId, seq: ++_seq }
}

export function getTitleRenameRequest(): RenameRequest | null {
  return _title
}

/** Asks the file tree to edit the row for `path` in place. */
export function requestTreeRename(path: string): void {
  _tree = { target: path, seq: ++_seq }
}

export function getTreeRenameRequest(): RenameRequest | null {
  return _tree
}

export function __resetRenameRequestsForTests(): void {
  _title = null
  _tree = null
  _seq = 0
}
