import { getActiveTab } from '$lib/workspace/tabs.svelte'
import { notePathOfTab } from '$lib/workspace/open-note'
import {
  canGoBack,
  canGoForward,
  goBack,
  goForward,
} from '$lib/workspace/history.svelte'
import {
  requestTitleRename,
  requestTreeRename,
} from '$lib/workspace/rename-requests.svelte'
import { getEditor } from '$lib/editor/editor-registry.svelte'
import { hasVault } from '$lib/stores/vault.svelte'
import {
  createAndOpenNote,
  getDoc,
  saveDoc,
  trashEntry,
} from '$lib/stores/notes.svelte'
import { getTreeSelection } from '$lib/stores/tree-state.svelte'
import { showSearch } from '$lib/stores/sidebar.svelte'
import { toggleQuickOpen } from '$lib/stores/overlays.svelte'
import { getContextKey } from './context-keys.svelte'
import { registerCommands, type AppCommand } from './registry.svelte'

export const NOTE_NEW = 'note.new'
export const NOTE_QUICK_OPEN = 'note.quickOpen'
export const NOTE_RENAME = 'note.rename'
export const NOTE_TRASH = 'note.trash'
export const NOTE_SAVE = 'note.save'
export const SEARCH_FIND = 'search.find'
export const SEARCH_VAULT = 'search.vault'
export const NAV_BACK = 'nav.back'
export const NAV_FORWARD = 'nav.forward'
export const EDITOR_BOLD = 'editor.bold'
export const EDITOR_ITALIC = 'editor.italic'

const NOTES = 'commands.category.notes'
const SEARCH = 'commands.category.search'
const NAVIGATION = 'commands.category.navigation'
const EDITOR = 'commands.category.editor'

/** The vault-relative path of the note in the active tab, if it is one. */
function activeNotePath(): string | null {
  return notePathOfTab(getActiveTab())
}

const hasActiveNote = (): boolean => activeNotePath() !== null

function activeEditor() {
  return getEditor(getActiveTab()?.id)
}

/** Whatever is selected in the active editor, trimmed to one line. */
function selectionQuery(): string | undefined {
  const text = activeEditor()?.selectedText().trim()
  if (!text || text.includes('\n')) return undefined
  return text
}

const noteCommands: AppCommand[] = [
  {
    id: NOTE_NEW,
    labelKey: 'commands.note.new',
    category: NOTES,
    shortcut: 'mod+n',
    // Scoped with `isEnabled` rather than `when: 'vaultOpen'`, so the File
    // menu item keeps its accelerator (see menu.ts).
    allowInInput: true,
    isEnabled: hasVault,
    run: () => {
      void createAndOpenNote()
    },
  },
  {
    id: NOTE_QUICK_OPEN,
    labelKey: 'commands.note.quickOpen',
    category: NOTES,
    shortcut: 'mod+o',
    allowInInput: true,
    isEnabled: hasVault,
    keywords: ['find', 'file', 'go to', 'switch'],
    run: toggleQuickOpen,
  },
  {
    id: NOTE_SAVE,
    labelKey: 'commands.note.save',
    category: NOTES,
    shortcut: 'mod+s',
    allowInInput: true,
    isEnabled: hasActiveNote,
    run: () => {
      const path = activeNotePath()
      if (path && getDoc(path)) void saveDoc(path)
    },
  },
  {
    id: NOTE_RENAME,
    labelKey: 'commands.note.rename',
    category: NOTES,
    shortcut: 'f2',
    allowInInput: true,
    when: 'vaultOpen',
    isEnabled: hasVault,
    run: () => {
      // The tree renames what is selected in it; everywhere else F2
      // renames the note being read.
      const selected = getTreeSelection()
      if (getContextKey('fileTreeFocus') && selected) {
        requestTreeRename(selected)
        return
      }
      const tab = getActiveTab()
      if (tab && notePathOfTab(tab)) requestTitleRename(tab.id)
    },
  },
  {
    id: NOTE_TRASH,
    labelKey: 'commands.note.trash',
    category: NOTES,
    keywords: ['delete', 'remove'],
    isEnabled: hasActiveNote,
    run: () => {
      const path = activeNotePath()
      if (path) void trashEntry(path)
    },
  },
  {
    id: SEARCH_FIND,
    labelKey: 'commands.search.find',
    category: SEARCH,
    shortcut: 'mod+f',
    allowInInput: true,
    when: 'vaultOpen',
    isEnabled: hasVault,
    run: () => {
      // In a note: CodeMirror's find panel. Anywhere else: the vault search.
      const editor = activeEditor()
      if (editor) editor.openFind()
      else showSearch()
    },
  },
  {
    id: SEARCH_VAULT,
    labelKey: 'commands.search.vault',
    category: SEARCH,
    shortcut: 'mod+shift+f',
    allowInInput: true,
    when: 'vaultOpen',
    isEnabled: hasVault,
    keywords: ['full text', 'grep'],
    run: () => showSearch(selectionQuery()),
  },
  {
    id: NAV_BACK,
    labelKey: 'commands.nav.back',
    category: NAVIGATION,
    shortcut: 'mod+[',
    allowInInput: true,
    isEnabled: canGoBack,
    run: () => {
      goBack()
    },
  },
  {
    id: NAV_FORWARD,
    labelKey: 'commands.nav.forward',
    category: NAVIGATION,
    shortcut: 'mod+]',
    allowInInput: true,
    isEnabled: canGoForward,
    run: () => {
      goForward()
    },
  },
  {
    id: EDITOR_BOLD,
    labelKey: 'commands.editor.bold',
    category: EDITOR,
    shortcut: 'mod+b',
    when: 'editorTextFocus',
    allowInInput: true,
    isEnabled: () => activeEditor() !== undefined,
    run: () => activeEditor()?.toggleBold(),
  },
  {
    id: EDITOR_ITALIC,
    labelKey: 'commands.editor.italic',
    category: EDITOR,
    shortcut: 'mod+i',
    when: 'editorTextFocus',
    allowInInput: true,
    isEnabled: () => activeEditor() !== undefined,
    run: () => activeEditor()?.toggleItalic(),
  },
]

export function registerNoteCommands(): void {
  registerCommands(noteCommands)
}
