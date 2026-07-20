<script lang="ts">
  import * as Select from '$lib/components/ui/select'
  import { Label } from '$lib/components/ui/label'
  import { Separator } from '$lib/components/ui/separator'
  import ShortcutPicker from './ShortcutPicker.svelte'
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
  const selectedLabel = $derived(
    options.find((o) => o.value === selected)?.label ?? '',
  )

  async function handleLanguageChange(value: string): Promise<void> {
    const language = value === SYSTEM ? null : value
    setPreference('language', language)
    // Reused rather than reimplemented: it already owns the
    // saved -> OS locale -> 'en' fallback chain used at startup.
    await initializeLanguage(language)
  }
</script>

<div class="space-y-2">
  <Label for="preferences-language">
    {t('preferences.general.languageLabel')}
  </Label>
  <Select.Root
    type="single"
    value={selected}
    onValueChange={handleLanguageChange}
  >
    <Select.Trigger id="preferences-language" class="w-[240px]">
      {selectedLabel}
    </Select.Trigger>
    <Select.Content>
      {#each options as option (option.value)}
        <Select.Item value={option.value} label={option.label}>
          {option.label}
        </Select.Item>
      {/each}
    </Select.Content>
  </Select.Root>
</div>

<Separator />

<div class="space-y-2">
  <Label>{t('preferences.general.shortcutLabel')}</Label>
  <p class="text-muted-foreground text-sm">
    {t('preferences.general.shortcutDescription')}
  </p>
  <ShortcutPicker />
</div>
