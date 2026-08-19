<script lang="ts">
  import { getTauriVersion } from '@tauri-apps/api/app'
  import { Button } from '$lib/components/ui/button'
  import { Label } from '$lib/components/ui/label'
  import { Separator } from '$lib/components/ui/separator'
  import { Switch } from '$lib/components/ui/switch'
  import PreferenceSelect from './PreferenceSelect.svelte'
  import { commands, unwrapResult } from '$lib/tauri-bindings'
  import { toast } from '$lib/stores/toast'
  import { t } from '$lib/i18n/t.svelte'
  import { formatDiagnostics } from '$lib/diagnostics'
  import {
    getHasUnsavedChanges,
    setHasUnsavedChanges,
  } from '$lib/stores/dirty.svelte'

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
  let crashReportCount = $state<number | null>(null)

  const densityOptions = $derived([
    {
      value: 'comfortable',
      label: t('preferences.advanced.densityComfortable'),
    },
    { value: 'compact', label: t('preferences.advanced.densityCompact') },
  ])

  async function openPreferencesFile(): Promise<void> {
    try {
      unwrapResult(await commands.openPreferencesFile())
    } catch {
      toast.error(t('preferences.advanced.editFileError'))
    }
  }

  async function copyDiagnostics(): Promise<void> {
    try {
      const tauriVersion = await getTauriVersion()
      const report = unwrapResult(
        await commands.collectDiagnostics(tauriVersion),
      )
      const text = formatDiagnostics(report)
      await navigator.clipboard.writeText(text)
      toast.success(t('preferences.advanced.diagnosticsCopied'))
    } catch {
      toast.error(t('preferences.advanced.diagnosticsCopyError'))
    }
  }

  async function loadCrashReportCount(): Promise<void> {
    try {
      const reports = unwrapResult(await commands.listCrashReports())
      crashReportCount = reports.length
    } catch {
      crashReportCount = null
    }
  }

  async function clearCrashReports(): Promise<void> {
    try {
      unwrapResult(await commands.clearCrashReports())
      crashReportCount = 0
      toast.success(t('preferences.advanced.clearCrashReportsSuccess'))
    } catch {
      toast.error(t('preferences.advanced.clearCrashReportsError'))
    }
  }

  $effect(() => {
    void loadCrashReportCount()
  })
</script>

<PreferenceSelect
  id="preferences-density"
  label={t('preferences.advanced.densityLabel')}
  description={t('preferences.advanced.densityDescription')}
  value={exampleDensity}
  options={densityOptions}
  onValueChange={(value) => (exampleDensity = value)}
/>

<Separator />

<div class="flex items-center justify-between gap-4">
  <div class="space-y-0.5">
    <Label for="preferences-unsaved-changes"
      >{t('preferences.advanced.unsavedChangesLabel')}</Label
    >
    <p class="text-muted-foreground text-sm">
      {t('preferences.advanced.unsavedChangesDescription')}
    </p>
  </div>
  <Switch
    id="preferences-unsaved-changes"
    checked={getHasUnsavedChanges()}
    onCheckedChange={(checked) => setHasUnsavedChanges(checked)}
  />
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

<Separator />

<div class="space-y-2">
  <Label>{t('preferences.advanced.diagnosticsSection')}</Label>
  <p class="text-muted-foreground text-sm">
    {t('preferences.advanced.diagnosticsDescription')}
  </p>
  <Button variant="outline" onclick={copyDiagnostics}>
    {t('preferences.advanced.diagnosticsCopyButton')}
  </Button>
</div>

<Separator />

<div class="space-y-2">
  <Label>{t('preferences.advanced.crashReportsSection')}</Label>
  <p class="text-muted-foreground text-sm">
    {#if crashReportCount != null}
      {t('preferences.advanced.crashReportsCount', { count: crashReportCount })}
    {/if}
  </p>
  {#if crashReportCount != null && crashReportCount > 0}
    <Button variant="outline" onclick={clearCrashReports}>
      {t('preferences.advanced.clearCrashReportsButton')}
    </Button>
  {/if}
</div>
