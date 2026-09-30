<script lang="ts">
  import { onMount } from 'svelte'
  import { Label } from '$lib/components/ui/label'
  import { Separator } from '$lib/components/ui/separator'
  import { Button } from '$lib/components/ui/button'
  import ExternalLinkIcon from '@lucide/svelte/icons/external-link'
  import { getName, getVersion, getTauriVersion } from '@tauri-apps/api/app'
  import { platform, arch, version } from '@tauri-apps/plugin-os'
  import { openUrl } from '@tauri-apps/plugin-opener'
  import { commands, unwrapResult } from '$lib/tauri-bindings'
  import type { UpdateInfo } from '$lib/tauri-bindings'
  import { isOffline } from '$lib/stores/network.svelte'
  import { setActivePreferencesPane } from '$lib/commands/preferences-dialog-state.svelte'
  import { describeError, isCoreError } from '$lib/core-error'
  import { t } from '$lib/i18n/t.svelte'

  let appName = $state('…')
  let appVersion = $state('…')
  let tauriVersion = $state('…')
  let platformInfo = $state('…')

  type UpdateState =
    | { status: 'idle' }
    | { status: 'checking' }
    | { status: 'upToDate' }
    | { status: 'available'; info: UpdateInfo }
    | { status: 'installing'; info: UpdateInfo }
    | { status: 'error'; message: string }

  let update = $state<UpdateState>({ status: 'idle' })

  const busy = $derived(
    update.status === 'checking' || update.status === 'installing',
  )

  onMount(async () => {
    const [name, ver, tauri, plat, archVal, osVer] = await Promise.all([
      getName(),
      getVersion(),
      getTauriVersion(),
      platform(),
      arch(),
      version(),
    ])
    appName = name
    appVersion = ver
    tauriVersion = tauri
    platformInfo = `${plat} ${osVer} (${archVal})`
  })

  function openLink(urlKey: string): void {
    void openUrl(t(urlKey))
  }

  // A missing updater endpoint surfaces as `featureDisabled`; that is a
  // property of the build, not something the user did wrong.
  function updateErrorMessage(e: unknown, fallbackKey: string): string {
    if (isCoreError(e) && e.kind === 'featureDisabled') {
      return t('preferences.about.updatesNotConfigured')
    }
    if (isCoreError(e) || e instanceof Error) {
      return `${t(fallbackKey)} ${describeError(e)}`
    }
    return t(fallbackKey)
  }

  async function checkForUpdates(): Promise<void> {
    update = { status: 'checking' }
    try {
      const info = unwrapResult(await commands.checkForUpdate())
      update = info ? { status: 'available', info } : { status: 'upToDate' }
    } catch (e) {
      update = {
        status: 'error',
        message: updateErrorMessage(e, 'preferences.about.updateError'),
      }
    }
  }

  // On success Rust restarts the app, so this only ever returns on failure.
  async function installUpdate(): Promise<void> {
    if (update.status !== 'available') return
    update = { status: 'installing', info: update.info }
    try {
      unwrapResult(await commands.installUpdate())
    } catch (e) {
      update = {
        status: 'error',
        message: updateErrorMessage(e, 'preferences.about.installError'),
      }
    }
  }
</script>

<div class="flex items-start justify-between gap-4">
  <div class="space-y-1">
    <p class="text-lg font-semibold">{appName}</p>
    <p class="text-muted-foreground text-sm">
      {t('preferences.about.versionLabel', { version: appVersion })}
    </p>
  </div>
  {#if update.status === 'available' || update.status === 'installing'}
    <Button
      variant="default"
      size="sm"
      disabled={busy || isOffline()}
      onclick={installUpdate}
    >
      {update.status === 'installing'
        ? t('preferences.about.updateInstalling')
        : t('preferences.about.installUpdate')}
    </Button>
  {:else}
    <Button
      variant="default"
      size="sm"
      disabled={busy || isOffline()}
      onclick={checkForUpdates}
    >
      {update.status === 'checking'
        ? t('preferences.about.updateChecking')
        : t('preferences.about.checkForUpdates')}
    </Button>
  {/if}
</div>

{#if isOffline()}
  <p class="text-muted-foreground text-sm">
    {t('preferences.about.offlineHint')}
    <button
      type="button"
      class="text-primary underline-offset-4 hover:underline"
      onclick={() => setActivePreferencesPane('privacy')}
    >
      {t('preferences.about.openPrivacySettings')}
    </button>
  </p>
{/if}

{#if update.status === 'upToDate'}
  <p class="text-muted-foreground text-sm" role="status">
    {t('preferences.about.upToDate')}
  </p>
{:else if update.status === 'error'}
  <p class="text-destructive text-sm" role="alert">{update.message}</p>
{:else if update.status === 'available' || update.status === 'installing'}
  <div class="space-y-2 rounded-md border p-3" role="status">
    <p class="text-sm font-medium">
      {t('preferences.about.updateAvailable', {
        version: update.info.version,
        current: update.info.currentVersion,
      })}
    </p>
    {#if update.info.notes}
      <div class="space-y-1">
        <p class="text-muted-foreground text-xs font-medium">
          {t('preferences.about.releaseNotes')}
        </p>
        <p
          class="text-muted-foreground max-h-40 overflow-y-auto text-sm whitespace-pre-wrap"
        >
          {update.info.notes}
        </p>
      </div>
    {/if}
  </div>
{/if}

<Separator />

<div class="space-y-3">
  <Label>{t('preferences.about.systemSection')}</Label>
  <div class="divide-y rounded-md border">
    <div class="flex items-center justify-between gap-4 px-3 py-2 text-sm">
      <span class="text-muted-foreground">
        {t('preferences.about.tauriVersionLabel')}
      </span>
      <span class="font-mono text-xs">{tauriVersion}</span>
    </div>
    <div class="flex items-center justify-between gap-4 px-3 py-2 text-sm">
      <span class="text-muted-foreground">
        {t('preferences.about.platformLabel')}
      </span>
      <span class="font-mono text-xs">{platformInfo}</span>
    </div>
  </div>
</div>

<Separator />

<div class="space-y-3">
  <Label>{t('preferences.about.linksSection')}</Label>
  <div class="flex flex-wrap gap-2">
    <Button
      variant="outline"
      size="sm"
      onclick={() => openLink('preferences.about.githubUrl')}
    >
      <ExternalLinkIcon class="size-3.5" />
      {t('preferences.about.githubLink')}
    </Button>
    <Button
      variant="outline"
      size="sm"
      onclick={() => openLink('preferences.about.websiteUrl')}
    >
      <ExternalLinkIcon class="size-3.5" />
      {t('preferences.about.websiteLink')}
    </Button>
    <Button
      variant="outline"
      size="sm"
      onclick={() => openLink('preferences.about.changelogUrl')}
    >
      <ExternalLinkIcon class="size-3.5" />
      {t('preferences.about.changelogLink')}
    </Button>
  </div>
</div>

<Separator />

<div class="space-y-2">
  <Label>{t('preferences.about.licenseSection')}</Label>
  <p class="text-muted-foreground text-sm">
    {t('preferences.about.licenseText')}
  </p>
</div>
