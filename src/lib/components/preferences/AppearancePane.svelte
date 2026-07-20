<script lang="ts">
  import PreferenceSelect from './PreferenceSelect.svelte'
  import { getThemeMode, setThemeMode } from '$lib/stores/theme.svelte'
  import type { ThemeMode } from '$lib/stores/preferences-schema'
  import { t } from '$lib/i18n/t.svelte'

  const options = $derived([
    { value: 'light', label: t('preferences.appearance.themeLight') },
    { value: 'dark', label: t('preferences.appearance.themeDark') },
    { value: 'system', label: t('preferences.appearance.themeSystem') },
  ])
</script>

<PreferenceSelect
  id="preferences-theme"
  label={t('preferences.appearance.themeLabel')}
  value={getThemeMode()}
  {options}
  onValueChange={(value) => setThemeMode(value as ThemeMode)}
/>
