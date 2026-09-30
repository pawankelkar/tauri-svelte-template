<script lang="ts">
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw'
  import Trash2Icon from '@lucide/svelte/icons/trash-2'
  import { Button } from '$lib/components/ui/button'
  import { Label } from '$lib/components/ui/label'
  import { Separator } from '$lib/components/ui/separator'
  import { Switch } from '$lib/components/ui/switch'
  import ProBadge from '$lib/components/ProBadge.svelte'
  import type { ProFeature, RequestRecord } from '$lib/tauri-bindings'
  import {
    clearActivity,
    getNetworkActivity,
    getNetworkPolicy,
    loadActivity,
    setAllowLocalhost,
    setOffline,
  } from '$lib/stores/network.svelte'
  import { isEntitled, setEntitlement } from '$lib/stores/entitlements.svelte'
  import { proFeatureLabel } from '$lib/core-error'
  import { i18n } from '$lib/i18n/config'
  import { t } from '$lib/i18n/t.svelte'

  const PRO_FEATURES: ProFeature[] = [
    'realtimeTranslation',
    'pdfAiQa',
    'premiumCloudModels',
  ]

  let refreshing = $state(false)

  async function refresh(): Promise<void> {
    refreshing = true
    try {
      await loadActivity()
    } finally {
      refreshing = false
    }
  }

  function formatTime(ms: number): string {
    return new Date(ms).toLocaleTimeString(i18n.language, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  function formatBytes(bytes: number | null): string {
    if (bytes == null) return '—'
    const units = ['B', 'KB', 'MB', 'GB']
    let value = bytes
    let unit = 0
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024
      unit++
    }
    const digits = unit === 0 ? 0 : 1
    return `${new Intl.NumberFormat(i18n.language, { maximumFractionDigits: digits }).format(value)} ${units[unit]}`
  }

  function rowKey(record: RequestRecord, index: number): string {
    return `${record.timestampMs}-${index}`
  }

  $effect(() => {
    void loadActivity()
  })
</script>

{#snippet switchRow(
  id: string,
  label: string,
  description: string,
  checked: boolean,
  onChange: (value: boolean) => void,
  feature?: ProFeature,
)}
  <div class="flex items-center justify-between gap-4">
    <div class="space-y-0.5">
      <div class="flex items-center gap-2">
        <Label for={id}>{label}</Label>
        {#if feature}
          <ProBadge {feature} />
        {/if}
      </div>
      <p class="text-muted-foreground text-sm">{description}</p>
    </div>
    <Switch {id} bind:checked={() => checked, onChange} />
  </div>
{/snippet}

{@render switchRow(
  'preferences-offline-mode',
  t('preferences.privacy.offlineLabel'),
  t('preferences.privacy.offlineDescription'),
  getNetworkPolicy().offline,
  (value) => void setOffline(value),
)}

{@render switchRow(
  'preferences-allow-localhost',
  t('preferences.privacy.allowLocalhostLabel'),
  t('preferences.privacy.allowLocalhostDescription'),
  getNetworkPolicy().allowLocalhost,
  (value) => void setAllowLocalhost(value),
)}

<Separator />

<div class="space-y-3">
  <div class="flex items-start justify-between gap-4">
    <div class="space-y-0.5">
      <Label>{t('preferences.privacy.activitySection')}</Label>
      <p class="text-muted-foreground text-sm">
        {t('preferences.privacy.activityDescription')}
      </p>
    </div>
    <div class="flex shrink-0 gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={refreshing}
        onclick={refresh}
      >
        <RefreshCwIcon class="size-3.5" />
        {t('preferences.privacy.activityRefresh')}
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={getNetworkActivity().length === 0}
        onclick={() => void clearActivity()}
      >
        <Trash2Icon class="size-3.5" />
        {t('preferences.privacy.activityClear')}
      </Button>
    </div>
  </div>

  {#if getNetworkActivity().length === 0}
    <p
      class="text-muted-foreground rounded-md border border-dashed px-3 py-6 text-center text-sm"
    >
      {t('preferences.privacy.activityEmpty')}
    </p>
  {:else}
    <div class="max-h-80 overflow-auto rounded-md border">
      <table class="w-full text-left text-xs">
        <thead class="bg-muted/50 text-muted-foreground sticky top-0">
          <tr>
            <th class="px-2 py-1.5 font-medium">
              {t('preferences.privacy.columnTime')}
            </th>
            <th class="px-2 py-1.5 font-medium">
              {t('preferences.privacy.columnMethod')}
            </th>
            <th class="px-2 py-1.5 font-medium">
              {t('preferences.privacy.columnHost')}
            </th>
            <th class="px-2 py-1.5 font-medium">
              {t('preferences.privacy.columnUrl')}
            </th>
            <th class="px-2 py-1.5 font-medium">
              {t('preferences.privacy.columnPurpose')}
            </th>
            <th class="px-2 py-1.5 font-medium">
              {t('preferences.privacy.columnOutcome')}
            </th>
            <th class="px-2 py-1.5 text-right font-medium">
              {t('preferences.privacy.columnStatus')}
            </th>
            <th class="px-2 py-1.5 text-right font-medium">
              {t('preferences.privacy.columnBytes')}
            </th>
            <th class="px-2 py-1.5 font-medium">
              {t('preferences.privacy.columnError')}
            </th>
          </tr>
        </thead>
        <tbody class="divide-y">
          {#each getNetworkActivity() as record, index (rowKey(record, index))}
            <tr class="align-top">
              <td class="px-2 py-1.5 font-mono whitespace-nowrap">
                {formatTime(record.timestampMs)}
              </td>
              <td class="px-2 py-1.5 font-mono">{record.method}</td>
              <td class="px-2 py-1.5 whitespace-nowrap">{record.host}</td>
              <td
                class="max-w-56 truncate px-2 py-1.5 font-mono"
                title={record.url}
              >
                {record.url}
              </td>
              <td class="px-2 py-1.5 whitespace-nowrap">{record.purpose}</td>
              <td class="px-2 py-1.5">
                <span
                  class={[
                    'rounded-full px-1.5 py-px text-[10px] font-semibold uppercase',
                    record.outcome === 'blocked'
                      ? 'bg-destructive/15 text-destructive'
                      : 'bg-primary/15 text-primary',
                  ]}
                >
                  {t(
                    record.outcome === 'blocked'
                      ? 'preferences.privacy.outcomeBlocked'
                      : 'preferences.privacy.outcomeSent',
                  )}
                </span>
              </td>
              <td class="px-2 py-1.5 text-right font-mono">
                {record.status ?? '—'}
              </td>
              <td class="px-2 py-1.5 text-right font-mono whitespace-nowrap">
                {formatBytes(record.bytes)}
              </td>
              <td
                class="text-destructive max-w-48 truncate px-2 py-1.5"
                title={record.error ?? undefined}
              >
                {record.error ?? ''}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<Separator />

<div class="space-y-4">
  <div class="space-y-0.5">
    <Label>{t('preferences.privacy.proSection')}</Label>
    <p class="text-muted-foreground text-sm">
      {t('preferences.privacy.proDescription')}
    </p>
  </div>
  {#each PRO_FEATURES as feature (feature)}
    {@render switchRow(
      `preferences-pro-${feature}`,
      proFeatureLabel(feature),
      t(`pro.feature.${feature}.description`),
      isEntitled(feature),
      (value) => void setEntitlement(feature, value),
      feature,
    )}
  {/each}
</div>
