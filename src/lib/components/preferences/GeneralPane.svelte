<script lang="ts">
  import PreferenceSelect from './PreferenceSelect.svelte'
  import { Label } from '$lib/components/ui/label'
  import { Switch } from '$lib/components/ui/switch'
  import { availableLanguages, languageLabels } from '$lib/i18n/config'
  import { initializeLanguage } from '$lib/i18n/language-init'
  import { getPreferences, setPreference } from '$lib/stores/preferences.svelte'
  import { commitAutostart, readAutostartState } from './autostart-toggle'
  import { toast } from '$lib/stores/toast'
  import { t } from '$lib/i18n/t.svelte'

  /** Sentinel for "follow the OS locale", stored as `null`. */
  const SYSTEM = 'system'

  // Live OS state, not a preference — see autostart-toggle.ts for why. The
  // pane is only mounted while its tab is visible, so this re-reads on every
  // visit and picks up changes made outside the app.
  let autostart = $state(false)
  $effect(() => {
    void readAutostartState().then((enabled) => (autostart = enabled))
  })

  async function handleAutostartChange(next: boolean): Promise<void> {
    const previous = autostart
    autostart = next
    const result = await commitAutostart(next)
    if (!result.ok) {
      autostart = previous
      toast.error(t('preferences.general.autostartError'))
    }
  }

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

<div class="flex items-center justify-between gap-4">
  <div class="space-y-1">
    <Label for="preferences-autostart">
      {t('preferences.general.autostartLabel')}
    </Label>
    <p class="text-muted-foreground text-sm">
      {t('preferences.general.autostartDescription')}
    </p>
  </div>
  <Switch
    id="preferences-autostart"
    checked={autostart}
    onCheckedChange={handleAutostartChange}
  />
</div>
