/**
 * String helpers for vault-relative paths (`/`-separated, no leading slash).
 *
 * Presentation and bookkeeping only: they name things for the UI and keep
 * open tabs pointed at the right file after a rename. Nothing here touches
 * the filesystem or decides what a link resolves to — Rust does both.
 */

/** The folder holding `path` (`''` for the vault root). */
export function parentOf(path: string): string {
  const at = path.lastIndexOf('/')
  return at === -1 ? '' : path.slice(0, at)
}

/** The last segment, extension included. */
export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export function joinPath(folder: string, name: string): string {
  return folder ? `${folder}/${name}` : name
}

export function isNotePath(path: string): boolean {
  return /\.md$/i.test(path)
}

/** The last segment without a `.md` extension. */
export function noteStem(path: string): string {
  const base = baseName(path)
  return isNotePath(base) ? base.slice(0, -3) : base
}

/** Whether `path` is `folder` itself or lives somewhere below it. */
export function isSameOrUnder(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`)
}

/**
 * Where `path` ends up after `from` was renamed to `to` — `from` may be a
 * note or a folder. Paths outside `from` come back unchanged.
 */
export function remapPath(path: string, from: string, to: string): string {
  if (path === from) return to
  if (path.startsWith(`${from}/`)) return to + path.slice(from.length)
  return path
}

/** Characters no file name may carry on any OS we ship on. */
// eslint-disable-next-line no-control-regex
const INVALID_NAME = /[\\/:*?"<>|\u0000-\u001f]/

/**
 * Checks a single file or folder name typed by the user. Returns an i18n key
 * describing the problem, or `null` when the name is fine.
 */
export function validateName(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'vault.names.empty'
  if (trimmed === '.' || trimmed === '..' || trimmed.startsWith('.')) {
    return 'vault.names.dot'
  }
  if (INVALID_NAME.test(trimmed)) return 'vault.names.invalidChars'
  return null
}

/**
 * The path a rename of `path` to the display name `name` should target:
 * notes keep their `.md` (added back when the user left it off), folders
 * take the name as typed.
 */
export function renameTarget(
  path: string,
  name: string,
  kind: 'note' | 'folder' | 'file',
): string {
  const trimmed = name.trim()
  const withExt =
    kind === 'note' && !isNotePath(trimmed) ? `${trimmed}.md` : trimmed
  return joinPath(parentOf(path), withExt)
}
