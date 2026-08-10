<script lang="ts">
  import { Label } from '$lib/components/ui/label'
  import { Separator } from '$lib/components/ui/separator'
  import { Input } from '$lib/components/ui/input'
  import { Button } from '$lib/components/ui/button'
  import SearchIcon from '@lucide/svelte/icons/search'
  import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw'
  import PencilIcon from '@lucide/svelte/icons/pencil'
  import ShortcutPicker from './ShortcutPicker.svelte'
  import {
    listCommands,
    getEffectiveShortcut,
    isShortcutCustomized,
    findShortcutConflict,
    setCommandShortcut,
    resetCommandShortcut,
    getCommand,
    type AppCommand,
    type ShortcutConflict,
  } from '$lib/commands'
  import {
    buildCombo,
    isValidGlobalShortcutCombo,
    parseShortcut,
    type ParsedShortcut,
  } from '$lib/shortcuts'
  import { formatShortcut } from '$lib/platform-strings'
  import { getPlatform } from '$lib/hooks/use-platform.svelte'
  import { t } from '$lib/i18n/t.svelte'

  let query = $state('')
  let editingId = $state<string | null>(null)
  let conflict = $state<ShortcutConflict | null>(null)

  let commands = $derived(listCommands())

  function getLabel(cmd: AppCommand): string {
    return cmd.label ? cmd.label() : t(cmd.labelKey)
  }

  function getShortcutDisplay(shortcut: string): string {
    const parsed: ParsedShortcut = parseShortcut(shortcut)
    return formatShortcut(getPlatform(), parsed.key, parsed.modifiers)
  }

  let grouped = $derived.by(() => {
    const q = query.trim().toLowerCase()
    const filtered = commands.filter(
      (cmd) => !q || getLabel(cmd).toLowerCase().includes(q),
    )
    // A plain Map is correct here, not SvelteMap: this one is rebuilt from
    // scratch every time `commands` or `query` changes and is never mutated
    // afterwards, so `$derived` already supplies the reactivity SvelteMap
    // would add.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const map = new Map<string, AppCommand[]>()
    for (const cmd of filtered) {
      const group = map.get(cmd.category) ?? []
      group.push(cmd)
      map.set(cmd.category, group)
    }
    return map
  })

  function conflictMessage(c: ShortcutConflict): string {
    if (c.kind === 'command') {
      const owner = getCommand(c.commandId)
      return t('preferences.shortcuts.conflict', {
        label: owner ? getLabel(owner) : c.commandId,
      })
    }
    return t('preferences.shortcuts.conflict', {
      label: t(
        c.purpose === 'focusMain'
          ? 'preferences.general.shortcutLabel'
          : 'preferences.general.quickPaneShortcutLabel',
      ),
    })
  }

  function beginEdit(id: string): void {
    editingId = id
    conflict = null
  }

  function stopEdit(): void {
    editingId = null
    conflict = null
  }

  function handleEditKeydown(event: KeyboardEvent, cmd: AppCommand): void {
    event.preventDefault()

    if (event.key === 'Escape') {
      stopEdit()
      return
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      setCommandShortcut(cmd.id, null)
      stopEdit()
      return
    }

    const combo = buildCombo(event)
    // Same shape rule as the dispatcher: a key plus at least one modifier.
    // Modifier-only presses are the user still assembling a combo.
    if (!isValidGlobalShortcutCombo(combo)) return

    const found = findShortcutConflict(combo, cmd.id)
    if (found) {
      // Stay in recording mode so the user can try another combo.
      conflict = found
      return
    }

    setCommandShortcut(cmd.id, combo)
    stopEdit()
  }

  function focusOnMount(node: HTMLElement) {
    node.focus()
  }
</script>

<div class="space-y-3">
  <Label>{t('preferences.shortcuts.globalSectionLabel')}</Label>
</div>

<div class="space-y-2">
  <Label>{t('preferences.general.shortcutLabel')}</Label>
  <p class="text-muted-foreground text-sm">
    {t('preferences.general.shortcutDescription')}
  </p>
  <ShortcutPicker purpose="focusMain" />
</div>

<Separator />

<div class="space-y-2">
  <Label>{t('preferences.general.quickPaneShortcutLabel')}</Label>
  <p class="text-muted-foreground text-sm">
    {t('preferences.general.quickPaneShortcutDescription')}
  </p>
  <ShortcutPicker purpose="quickPane" />
</div>

<Separator />

<div class="space-y-3">
  <Label>{t('preferences.shortcuts.appSectionLabel')}</Label>
  <p class="text-muted-foreground text-sm">
    {t('preferences.shortcuts.appSectionDescription')}
  </p>
  <div class="relative">
    <SearchIcon
      class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
    />
    <Input
      class="pl-8"
      placeholder={t('preferences.shortcuts.searchPlaceholder')}
      bind:value={query}
    />
  </div>

  {#if grouped.size === 0}
    <p class="text-muted-foreground text-sm">
      {t('preferences.shortcuts.noMatches', { query })}
    </p>
  {:else}
    {#each grouped as [category, cmds] (category)}
      <div class="space-y-1">
        <p class="text-muted-foreground text-xs font-medium uppercase">
          {t(category)}
        </p>
        <div class="divide-y rounded-md border">
          {#each cmds as cmd (cmd.id)}
            {@const shortcut = getEffectiveShortcut(cmd)}
            <div class="px-3 py-1.5">
              <div class="flex items-center justify-between gap-4">
                <span class="text-sm">{getLabel(cmd)}</span>
                {#if editingId === cmd.id}
                  <input
                    class="border-input ring-ring w-[200px] rounded-md border px-2 py-1 text-right font-mono text-xs ring-2 outline-none"
                    readonly
                    value={t('shortcutPicker.listening')}
                    onkeydown={(e) => handleEditKeydown(e, cmd)}
                    onblur={stopEdit}
                    use:focusOnMount
                  />
                {:else}
                  <span class="flex items-center gap-1">
                    {#if isShortcutCustomized(cmd.id)}
                      <Button
                        variant="ghost"
                        size="icon"
                        class="text-muted-foreground size-7"
                        title={t('preferences.shortcuts.resetTitle')}
                        aria-label={t('preferences.shortcuts.resetTitle')}
                        onclick={() => resetCommandShortcut(cmd.id)}
                      >
                        <RotateCcwIcon class="size-3.5" />
                      </Button>
                    {/if}
                    <span class="text-muted-foreground font-mono text-xs">
                      {shortcut ? getShortcutDisplay(shortcut) : '—'}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="text-muted-foreground size-7"
                      title={t('preferences.shortcuts.editShortcut', {
                        label: getLabel(cmd),
                      })}
                      aria-label={t('preferences.shortcuts.editShortcut', {
                        label: getLabel(cmd),
                      })}
                      onclick={() => beginEdit(cmd.id)}
                    >
                      <PencilIcon class="size-3.5" />
                    </Button>
                  </span>
                {/if}
              </div>
              {#if editingId === cmd.id && conflict}
                <p class="text-destructive pb-1 text-right text-xs">
                  {conflictMessage(conflict)}
                </p>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/each}
  {/if}
</div>
