<script lang="ts">
  import * as Select from '$lib/components/ui/select'
  import { Button } from '$lib/components/ui/button'
  import { Label } from '$lib/components/ui/label'
  import { Separator } from '$lib/components/ui/separator'
  import { commands, unwrapResult } from '$lib/tauri-bindings'
  import { toast } from '$lib/stores/toast'
  import { t } from '$lib/i18n/t.svelte'

  // ---------------------------------------------------------------------------
  // These two controls are a deliberately NON-persistent example. They exist to
  // show where your own settings go; their values reset when the dialog closes.
  //
  // To make a preference persistent:
  //   1. Add the field to `AppPreferences` in src-tauri/src/types.rs
  //      (serde renames to camelCase, so `my_setting` -> `mySetting`).
  //   2. Add it to `defaultPreferences()` and `sanitizePreferences()` in
  //      src/lib/stores/preferences-schema.ts.
  //   3. Run `pnpm run rust:bindings` to regenerate src/lib/bindings.ts.
  //   4. Read it with `getPreferences().mySetting` and write it with
  //      `setPreference('mySetting', value)` — that debounces the save for you.
  //      Use `setPreferenceImmediate()` instead when you need to know the write
  //      reached disk (see ShortcutPicker for a rollback example).
  // ---------------------------------------------------------------------------
  let exampleDensity = $state('comfortable')

  const densityOptions = $derived([
    {
      value: 'comfortable',
      label: t('preferences.advanced.densityComfortable'),
    },
    { value: 'compact', label: t('preferences.advanced.densityCompact') },
  ])

  const densityLabel = $derived(
    densityOptions.find((o) => o.value === exampleDensity)?.label ?? '',
  )

  async function openPreferencesFile(): Promise<void> {
    try {
      unwrapResult(await commands.openPreferencesFile())
    } catch {
      toast.error(t('preferences.advanced.editFileError'))
    }
  }
</script>

<div class="space-y-2">
  <Label for="preferences-density">
    {t('preferences.advanced.densityLabel')}
  </Label>
  <p class="text-muted-foreground text-sm">
    {t('preferences.advanced.densityDescription')}
  </p>
  <Select.Root
    type="single"
    value={exampleDensity}
    onValueChange={(value) => (exampleDensity = value)}
  >
    <Select.Trigger id="preferences-density" class="w-[240px]">
      {densityLabel}
    </Select.Trigger>
    <Select.Content>
      {#each densityOptions as option (option.value)}
        <Select.Item value={option.value} label={option.label}>
          {option.label}
        </Select.Item>
      {/each}
    </Select.Content>
  </Select.Root>
</div>

<Separator />

<div class="space-y-2">
  <Label>{t('preferences.advanced.editFileLabel')}</Label>
  <p class="text-muted-foreground text-sm">
    {t('preferences.advanced.editFileDescription')}
  </p>
  <Button variant="outline" onclick={openPreferencesFile}>
    {t('preferences.advanced.editFileButton')}
  </Button>
</div>
