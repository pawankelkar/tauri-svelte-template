import { DEEP_LINK_SCHEME } from '$lib/deep-link'
import { MAX_TAB_URI_LEN } from '$lib/stores/app-state-schema'

/**
 * Something a workspace URI points at.
 *
 * - `note`: a vault-relative note path (`/`-separated, never absolute), with
 *   an optional heading anchor.
 * - `view`: a built-in, non-note view such as a settings pane.
 * - `search`: a search query.
 */
export type WorkspaceTarget =
  | { kind: 'note'; path: string; heading?: string }
  | { kind: 'view'; id: string }
  | { kind: 'search'; query: string }

const PREFIX = `${DEEP_LINK_SCHEME}://`

/**
 * View ids are identifiers, not free text: they end up inside a tab `kind`
 * (`view:<id>`, capped at 64 bytes), so they are kept short and ASCII.
 */
const VIEW_ID = /^[a-z0-9][a-z0-9._-]{0,58}$/i

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/
const WINDOWS_DRIVE = /^[a-z]:$/i

const utf8 = new TextEncoder()

function decode(component: string): string | null {
  try {
    return decodeURIComponent(component)
  } catch {
    return null
  }
}

/**
 * Decodes and validates a vault-relative path. Rejects anything that could
 * name a file outside the vault or confuse a filesystem: empty or dot
 * segments, absolute paths (a leading `/` shows up as an empty first
 * segment), Windows drive letters, backslashes, encoded slashes, and control
 * characters (NUL included).
 */
function parseNotePath(encoded: string): string | null {
  if (encoded === '') return null
  const segments: string[] = []
  for (const raw of encoded.split('/')) {
    const segment = decode(raw)
    if (segment === null || segment === '') return null
    if (segment === '.' || segment === '..') return null
    if (segment.includes('/') || segment.includes('\\')) return null
    if (CONTROL_CHARS.test(segment)) return null
    segments.push(segment)
  }
  if (WINDOWS_DRIVE.test(segments[0]!)) return null
  return segments.join('/')
}

function parseHeading(fragment: string | null): string | undefined | null {
  if (fragment === null || fragment === '') return undefined
  const heading = decode(fragment)
  if (heading === null || CONTROL_CHARS.test(heading)) return null
  return heading.trim() === '' ? undefined : heading
}

/**
 * Parses an `ostralith://` URI, or returns `null` for anything malformed,
 * unsafe, or of an unknown kind. The scheme and the kind (`note`, `view`,
 * `search`) are matched case-insensitively; everything after them is
 * case-preserving.
 *
 * Accepted forms:
 * - `ostralith://note/<percent-encoded path segments>[#<heading>]`
 * - `ostralith://view/<viewId>`
 * - `ostralith://search?q=<query>`
 */
export function parseUri(raw: string): WorkspaceTarget | null {
  if (typeof raw !== 'string') return null
  const uri = raw.trim()
  if (utf8.encode(uri).length > MAX_TAB_URI_LEN) return null
  if (uri.slice(0, PREFIX.length).toLowerCase() !== PREFIX) return null

  let rest = uri.slice(PREFIX.length)
  let fragment: string | null = null
  const hashAt = rest.indexOf('#')
  if (hashAt !== -1) {
    fragment = rest.slice(hashAt + 1)
    rest = rest.slice(0, hashAt)
  }
  let query = ''
  const queryAt = rest.indexOf('?')
  if (queryAt !== -1) {
    query = rest.slice(queryAt + 1)
    rest = rest.slice(0, queryAt)
  }

  const slashAt = rest.indexOf('/')
  const authority = (
    slashAt === -1 ? rest : rest.slice(0, slashAt)
  ).toLowerCase()
  const path = slashAt === -1 ? '' : rest.slice(slashAt + 1)

  switch (authority) {
    case 'note': {
      const notePath = parseNotePath(path)
      if (notePath === null) return null
      const heading = parseHeading(fragment)
      if (heading === null) return null
      return heading === undefined
        ? { kind: 'note', path: notePath }
        : { kind: 'note', path: notePath, heading }
    }
    case 'view': {
      const id = decode(path)
      if (id === null || !VIEW_ID.test(id)) return null
      return { kind: 'view', id }
    }
    case 'search': {
      // `search` and `search/` are the same place; anything deeper is not.
      if (path !== '') return null
      const q = new URLSearchParams(query).get('q')
      if (q === null || q.trim() === '' || CONTROL_CHARS.test(q)) return null
      return { kind: 'search', query: q }
    }
    default:
      return null
  }
}

/**
 * The canonical URI for a target — the inverse of `parseUri` for any valid
 * target, so `parseUri(formatUri(t))` round-trips. Canonical form matters:
 * tabs are de-duplicated by URI.
 */
export function formatUri(target: WorkspaceTarget): string {
  switch (target.kind) {
    case 'note': {
      const path = target.path
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/')
      const heading = target.heading
        ? `#${encodeURIComponent(target.heading)}`
        : ''
      return `${PREFIX}note/${path}${heading}`
    }
    case 'view':
      return `${PREFIX}view/${encodeURIComponent(target.id)}`
    case 'search':
      return `${PREFIX}search?q=${encodeURIComponent(target.query)}`
  }
}

/** The last path segment without a `.md` extension, for a tab title. */
export function noteTitleFromPath(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const title = base.replace(/\.md$/i, '')
  return title === '' ? base : title
}
