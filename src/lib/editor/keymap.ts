/**
 * Editor key handling: app commands first, then CodeMirror's own bindings.
 *
 * CodeMirror ships bindings on chords the app owns (Mod-f, Mod-[, Mod-i…).
 * Two layers keep the app's keymap authoritative, including after the user
 * rebinds something:
 *
 * 1. A highest-precedence keydown handler asks the command registry about
 *    every chord. If it resolves to a command allowed in text fields, that
 *    command runs and CodeMirror never sees the key.
 * 2. Bindings that make no sense in a Markdown note, or that shadow a
 *    default app chord, are dropped from CodeMirror's keymaps outright.
 */
import { closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import {
  defaultKeymap,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands'
import { searchKeymap } from '@codemirror/search'
import { Prec } from '@codemirror/state'
import { EditorView, keymap, type KeyBinding } from '@codemirror/view'
import { buildCombo, isShortcutCombo } from '$lib/shortcuts'
import { executeCommand, resolveShortcut } from '$lib/commands/registry.svelte'

/**
 * CodeMirror bindings removed from the note editor:
 * - `Mod-f`: in-note find is the app's `search.find`, which opens the same
 *   panel but can be rebound.
 * - `Mod-/`, `Shift-Alt-a`: code comments, meaningless in Markdown.
 * - `Mod-i`: CodeMirror's "select parent syntax"; the chord is italic.
 * - `Mod-[`, `Mod-]`: indent; the chords are back / forward (Tab indents).
 * - `Mod-Alt-\\`, `Shift-Mod-\\`: the sidebar toggles' chords.
 */
export const BLOCKED_EDITOR_KEYS: ReadonlySet<string> = new Set([
  'Mod-f',
  'Mod-/',
  'Shift-Alt-a',
  'Mod-i',
  'Mod-[',
  'Mod-]',
  'Mod-Alt-\\',
  'Shift-Mod-\\',
])

function allowed(binding: KeyBinding): boolean {
  return (
    !(binding.key && BLOCKED_EDITOR_KEYS.has(binding.key)) &&
    !(binding.mac && BLOCKED_EDITOR_KEYS.has(binding.mac))
  )
}

/** CodeMirror's keymaps, minus the blocked chords. Exported for tests. */
export function editorBindings(): KeyBinding[] {
  return [
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...searchKeymap,
    ...historyKeymap,
    ...completionKeymap,
    indentWithTab,
  ].filter(allowed)
}

/**
 * The app command a keydown inside the editor should run instead of
 * CodeMirror, if any. Exported for tests.
 */
export function appCommandForKey(event: KeyboardEvent): string | undefined {
  const combo = buildCombo(event)
  if (!isShortcutCombo(combo)) return undefined
  const command = resolveShortcut(combo)
  // Commands not meant for text fields leave the key to the editor, just
  // as the window-level dispatcher does for any other editable element.
  return command?.allowInInput ? command.id : undefined
}

const appCommandsFirst = Prec.highest(
  EditorView.domEventHandlers({
    keydown(event) {
      const id = appCommandForKey(event)
      if (!id) return false
      // Returning true makes CodeMirror preventDefault, which in turn keeps
      // the window-level dispatcher from running the command a second time.
      void executeCommand(id)
      return true
    },
  }),
)

export function editorKeymap() {
  return [appCommandsFirst, keymap.of(editorBindings())]
}
