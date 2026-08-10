<script lang="ts">
  import PreferenceSelect from './PreferenceSelect.svelte'
  import { availableLanguages, languageLabels } from '$lib/i18n/config'
  import { initializeLanguage } from '$lib/i18n/language-init'
  import { getPreferences, setPreference } from '$lib/stores/preferences.svelte'
  import { t } from '$lib/i18n/t.svelte'

  /** Sentinel for "follow the OS locale", stored as `null`. */
  const SYSTEM = 'system'

  const options = $derived([
    { value: SYSTEM, label: t('preferences.general.languageSystemOption') },
    ...availableLanguages.map((code) => ({
      value: code,
      label: languageLabels[code] ?? code,
    })),
  ])

  const selected = $derived(getPreferences().language ?? SYSTEM)

  async function handleLanguageChange(value: string): Promise<void> {
    const language = value === SYSTEM ? null : value
    setPreference('language', language)
    // Reused rather than reimplemented: it already owns the
    // saved -> OS locale -> 'en' fallback chain used at startup.
    await initializeLanguage(language)
  }
</script>

<PreferenceSelect
  id="preferences-language"
  label={t('preferences.general.languageLabel')}
  value={selected}
  {options}
  onValueChange={handleLanguageChange}
/>
