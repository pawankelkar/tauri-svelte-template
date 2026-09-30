<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog'
  import * as Sidebar from '$lib/components/ui/sidebar'
  import * as Breadcrumb from '$lib/components/ui/breadcrumb'
  import SettingsIcon from '@lucide/svelte/icons/settings-2'
  import PaintbrushIcon from '@lucide/svelte/icons/paintbrush'
  import SlidersIcon from '@lucide/svelte/icons/sliders-horizontal'
  import KeyboardIcon from '@lucide/svelte/icons/keyboard'
  import InfoIcon from '@lucide/svelte/icons/info'
  import ShieldIcon from '@lucide/svelte/icons/shield'
  import GeneralPane from './GeneralPane.svelte'
  import AppearancePane from './AppearancePane.svelte'
  import ShortcutsPane from './ShortcutsPane.svelte'
  import PrivacyPane from './PrivacyPane.svelte'
  import AdvancedPane from './AdvancedPane.svelte'
  import AboutPane from './AboutPane.svelte'
  import {
    getActivePreferencesPane,
    isPreferencesDialogOpen,
    setActivePreferencesPane,
    setPreferencesDialogOpen,
    type PreferencesPaneId,
  } from '$lib/commands/preferences-dialog-state.svelte'
  import { t } from '$lib/i18n/t.svelte'

  const NAV: {
    id: PreferencesPaneId
    icon: typeof SettingsIcon
    labelKey: string
  }[] = [
    { id: 'general', icon: SettingsIcon, labelKey: 'preferences.nav.general' },
    {
      id: 'appearance',
      icon: PaintbrushIcon,
      labelKey: 'preferences.nav.appearance',
    },
    {
      id: 'shortcuts',
      icon: KeyboardIcon,
      labelKey: 'preferences.nav.shortcuts',
    },
    { id: 'privacy', icon: ShieldIcon, labelKey: 'preferences.nav.privacy' },
    { id: 'advanced', icon: SlidersIcon, labelKey: 'preferences.nav.advanced' },
    { id: 'about', icon: InfoIcon, labelKey: 'preferences.nav.about' },
  ]

  const activeLabelKey = $derived(
    NAV.find((item) => item.id === getActivePreferencesPane())?.labelKey ??
      'preferences.nav.general',
  )
</script>

<Dialog.Root
  open={isPreferencesDialogOpen()}
  onOpenChange={setPreferencesDialogOpen}
>
  <Dialog.Content
    class="overflow-hidden p-0 md:max-h-[90vh] md:max-w-[90vw] lg:max-w-[1200px]"
  >
    <!-- The visible heading is the breadcrumb, so the dialog's own title and
         description exist for screen readers only. -->
    <Dialog.Title class="sr-only">{t('preferences.title')}</Dialog.Title>
    <Dialog.Description class="sr-only">
      {t('preferences.description')}
    </Dialog.Description>

    <!-- `collapsible="none"` renders a plain flex column and skips the
         Sidebar's offcanvas/mobile-sheet machinery entirely — that is what
         makes the sidebar safe to nest inside a dialog. `min-h-0` overrides
         the provider's default `min-h-svh`, which would stretch the dialog
         to the full window height and leave a dead area below the content
         column (whose own height caps at 46rem). -->
    <Sidebar.Provider class="min-h-0 items-stretch">
      <Sidebar.Root collapsible="none" class="hidden md:flex">
        <Sidebar.Content>
          <Sidebar.Group>
            <Sidebar.GroupContent>
              <Sidebar.Menu>
                {#each NAV as item (item.id)}
                  <Sidebar.MenuItem>
                    <Sidebar.MenuButton
                      isActive={getActivePreferencesPane() === item.id}
                      onclick={() => setActivePreferencesPane(item.id)}
                    >
                      <item.icon />
                      <span>{t(item.labelKey)}</span>
                    </Sidebar.MenuButton>
                  </Sidebar.MenuItem>
                {/each}
              </Sidebar.Menu>
            </Sidebar.GroupContent>
          </Sidebar.Group>
        </Sidebar.Content>
      </Sidebar.Root>

      <main class="flex h-[min(54rem,90vh)] flex-1 flex-col overflow-hidden">
        <header class="flex h-16 shrink-0 items-center gap-2 px-4">
          <Breadcrumb.Root>
            <Breadcrumb.List>
              <Breadcrumb.Item class="hidden md:block">
                {t('preferences.title')}
              </Breadcrumb.Item>
              <Breadcrumb.Separator class="hidden md:block" />
              <Breadcrumb.Item>
                <Breadcrumb.Page>{t(activeLabelKey)}</Breadcrumb.Page>
              </Breadcrumb.Item>
            </Breadcrumb.List>
          </Breadcrumb.Root>
        </header>
        <div class="flex flex-1 flex-col gap-4 overflow-y-auto p-4 pt-0">
          {#if getActivePreferencesPane() === 'general'}
            <GeneralPane />
          {:else if getActivePreferencesPane() === 'appearance'}
            <AppearancePane />
          {:else if getActivePreferencesPane() === 'shortcuts'}
            <ShortcutsPane />
          {:else if getActivePreferencesPane() === 'privacy'}
            <PrivacyPane />
          {:else if getActivePreferencesPane() === 'advanced'}
            <AdvancedPane />
          {:else}
            <AboutPane />
          {/if}
        </div>
      </main>
    </Sidebar.Provider>
  </Dialog.Content>
</Dialog.Root>
