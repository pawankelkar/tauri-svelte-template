import { getPreferences, setPreference } from '$lib/stores/preferences.svelte'
import { toast } from '$lib/stores/toast'
import i18n from '$lib/i18n/config'
import { OPEN_COMMAND_PALETTE } from './app-commands'
import { getCommand, getEffectiveShortcut } from './registry.svelte'
import { formatCombo } from './shortcut-display'

/**
 * The `prefsVersion` that introduced the current default keymap: palette
 * mod+k → mod+shift+p, sidebars mod+b / mod+shift+b → mod+\ / mod+alt+\.
 * Files saved before versioning existed load as 0; fresh installs start at
 * `CURRENT_PREFS_VERSION` (preferences-schema.ts) and skip this entirely.
 *
 * A step of its own rather than `CURRENT_PREFS_VERSION`, so a later schema
 * bump doesn't re-run it (or let it stamp past migrations it knows nothing
 * about). Overrides in `commandShortcuts` are keyed by command id, not
 * combo, so they carry over untouched.
 */
const KEYMAP_V1 = 1

/**
 * One-time notice for users upgrading across a default-keymap change, then
 * stamps the preferences so it never shows again. Call after preferences are
 * loaded and the commands registered.
 */
export function runKeymapMigration(): void {
  const prefs = getPreferences()
  if ((prefs.prefsVersion ?? 0) >= KEYMAP_V1) return

  // Only announce the move if it actually happened for this user — someone
  // who rebound (or unbound) the palette kept their own binding.
  const palette = getCommand(OPEN_COMMAND_PALETTE)
  const shortcut = palette ? getEffectiveShortcut(palette) : undefined
  if (palette && shortcut === palette.shortcut && shortcut) {
    toast.info(
      i18n.t('keymap.migration.paletteMoved', {
        shortcut: formatCombo(shortcut),
      }),
      { duration: 10000 },
    )
  }

  setPreference('prefsVersion', KEYMAP_V1)
}
