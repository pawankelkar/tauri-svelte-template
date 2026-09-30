import { openPreferencesDialog } from '$lib/commands/preferences-dialog-state.svelte'
import type { PreferencesPaneId } from '$lib/commands/preferences-dialog-state.svelte'
import { toast } from '$lib/stores/toast'
import { t } from '$lib/i18n/t.svelte'
import { logger } from '$lib/logger'
import { showSearch } from '$lib/stores/sidebar.svelte'
import { formatUri, parseUri } from './uri'
import { openTab } from './tabs.svelte'
import { openNote } from './open-note'

/**
 * Preferences panes reachable as `ostralith://view/settings.<pane>`. Listed
 * rather than derived so a URL can never name a pane that does not exist;
 * the `Record` type makes adding a pane without listing it here a type
 * error, so a new pane is deep-linkable from day one.
 */
const SETTINGS_PANES: Record<PreferencesPaneId, true> = {
  general: true,
  appearance: true,
  shortcuts: true,
  privacy: true,
  advanced: true,
  about: true,
}

function settingsPane(id: string): PreferencesPaneId | null | undefined {
  if (id === 'settings') return null
  if (!id.startsWith('settings.')) return undefined
  const pane = id.slice('settings.'.length)
  return Object.hasOwn(SETTINGS_PANES, pane)
    ? (pane as PreferencesPaneId)
    : undefined
}

/**
 * Routes one incoming `ostralith://` URL: notes and views open (or focus) a
 * tab, settings views open the preferences dialog, a search opens the
 * sidebar's search with the query, and anything malformed is explained with
 * a toast rather than dropped silently.
 */
export function routeDeepLink(url: string): void {
  const target = parseUri(url)
  if (!target) {
    logger.warn('Ignoring invalid deep link', url)
    toast.warning(t('workspace.deepLink.invalid'), { description: url })
    return
  }

  switch (target.kind) {
    case 'note':
      // One tab per note whatever the spelling; the heading is a position
      // within it, scrolled to once the editor is up.
      openNote(target.path, {
        reveal: target.heading ? { heading: target.heading } : undefined,
      })
      return
    case 'view': {
      const pane = settingsPane(target.id)
      if (pane !== undefined) {
        openPreferencesDialog(pane ?? undefined)
        return
      }
      openTab({
        kind: `view:${target.id}`,
        uri: formatUri(target),
        title: target.id,
      })
      return
    }
    case 'search':
      showSearch(target.query)
      return
  }
}
