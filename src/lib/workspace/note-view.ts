import FileTextIcon from '@lucide/svelte/icons/file-text'
import { registerView } from './view-registry'
import { NOTE_VIEW_KIND } from './open-note'

/**
 * Registers the note tab view. The editor (CodeMirror and all) is its own
 * chunk, fetched the first time a note tab is shown.
 */
export function registerNoteView(): () => void {
  return registerView({
    kind: NOTE_VIEW_KIND,
    component: () => import('$lib/components/editor/NoteView.svelte'),
    titleKey: 'editor.untitled',
    icon: FileTextIcon,
  })
}
