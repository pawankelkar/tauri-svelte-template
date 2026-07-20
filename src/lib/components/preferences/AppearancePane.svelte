<script lang="ts">
  import * as Select from '$lib/components/ui/select'
  import { Label } from '$lib/components/ui/label'
  import { getThemeMode, setThemeMode } from '$lib/stores/theme.svelte'
  import type { ThemeMode } from '$lib/stores/preferences-schema'
  import { t } from '$lib/i18n/t.svelte'

  const options = $derived([
    { value: 'light', label: t('preferences.appearance.themeLight') },
    { value: 'dark', label: t('preferences.appearance.themeDark') },
    { value: 'system', label: t('preferences.appearance.themeSystem') },
  ])

  const selectedLabel = $derived(
    options.find((o) => o.value === getThemeMode())?.label ?? '',
  )
</script>

<div class="space-y-2">
  <Label for="preferences-theme">
    {t('preferences.appearance.themeLabel')}
  </Label>
  <Select.Root
    type="single"
    value={getThemeMode()}
    onValueChange={(value) => setThemeMode(value as ThemeMode)}
  >
    <Select.Trigger id="preferences-theme" class="w-[240px]">
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
