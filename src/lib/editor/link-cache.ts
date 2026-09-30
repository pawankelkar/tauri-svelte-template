/**
 * Wikilink resolution, cached.
 *
 * Every `[[link]]` on screen needs to know whether its note exists, and
 * Rust decides that (`resolveLink`, Obsidian rules). Answers are cached per
 * `(from note, target)` and the whole cache is dropped whenever the vault
 * tree is re-read — a create, rename, trash or external edit can change
 * what any link resolves to.
 */
import type { LinkTarget } from '$lib/tauri-bindings'
import * as api from '$lib/vault/api'
import { createNoteFromName } from '$lib/stores/notes.svelte'
import { openNote } from '$lib/workspace/open-note'
import { logger } from '$lib/logger'
import { splitWikiLink } from './wikilink-syntax'

const _cache = new Map<string, LinkTarget>()
const _pending = new Map<string, Promise<LinkTarget | null>>()
let _generation = 0
let _treeVersion = -1

function key(fromPath: string, target: string): string {
  return `${fromPath}\u0000${target}`
}

/** Drops every cached answer when the tree has changed since last time. */
export function syncLinkCache(treeVersion: number): boolean {
  if (treeVersion === _treeVersion) return false
  _treeVersion = treeVersion
  _cache.clear()
  _pending.clear()
  _generation++
  return true
}

/** The cached resolution, or `undefined` if not asked yet. */
export function cachedLink(
  fromPath: string,
  target: string,
): LinkTarget | undefined {
  return _cache.get(key(fromPath, target))
}

/** Resolves (and caches) a link. `null` if Rust could not answer. */
export function resolveLinkCached(
  fromPath: string,
  target: string,
): Promise<LinkTarget | null> {
  const k = key(fromPath, target)
  const hit = _cache.get(k)
  if (hit) return Promise.resolve(hit)
  const inflight = _pending.get(k)
  if (inflight) return inflight
  const generation = _generation
  const promise = api
    .resolveLink(fromPath, target)
    .then((link) => {
      if (generation === _generation) _cache.set(k, link)
      return link
    })
    .catch((e: unknown) => {
      logger.warn(`Resolving [[${target}]] failed`, e)
      return null
    })
    .finally(() => {
      if (_pending.get(k) === promise) _pending.delete(k)
    })
  _pending.set(k, promise)
  return promise
}

/**
 * Follows the link inside `[[…]]`: opens the note (at its heading), or
 * creates it when it does not exist yet — the usual way to start a new
 * note from a link.
 */
export async function followWikiLink(
  fromPath: string,
  inner: string,
  options: { newTab?: boolean } = {},
): Promise<void> {
  const parts = splitWikiLink(inner)
  const link = await resolveLinkCached(fromPath, parts.target)
  if (!link) return
  const heading = link.heading ?? parts.heading
  if (link.exists && link.path) {
    openNote(link.path, {
      preview: !options.newTab,
      reveal: heading ? { heading } : undefined,
    })
    return
  }
  if (!parts.note) return
  // `[[Folder/Name]]` creates Name in Folder when that folder exists.
  await createNoteFromName(parts.note)
}

export function __resetLinkCacheForTests(): void {
  _cache.clear()
  _pending.clear()
  _generation = 0
  _treeVersion = -1
}
