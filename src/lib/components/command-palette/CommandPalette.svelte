<script lang="ts">
  import * as Command from '$lib/components/ui/command'
  import {
    isPaletteOpen,
    setPaletteOpen,
    closePalette,
    listCommands,
    getEffectiveShortcut,
    isCommandVisible,
    isCommandEnabled,
    executeCommand,
    formatCombo,
  } from '$lib/commands'
  import { showTextInputContextMenu } from '$lib/context-menu'
  import { t } from '$lib/i18n/t.svelte'

  type GroupedCommands = Map<string, typeof commands>

  // `when` is deliberately not applied here: it scopes the keyboard binding,
  // and opening the palette moves focus, so every focus-scoped command would
  // vanish the moment the user went looking for it.
  let commands = $derived(listCommands().filter(isCommandVisible))

  let grouped = $derived.by((): GroupedCommands => {
    // A plain Map is correct here, not SvelteMap: this one is rebuilt from
    // scratch every time `commands` changes and is never mutated afterwards,
    // so `$derived` already supplies the reactivity SvelteMap would add.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const map = new Map<string, typeof commands>()
    for (const cmd of commands) {
      const group = map.get(cmd.category) ?? []
      group.push(cmd)
      map.set(cmd.category, group)
    }
    return map
  })

  function getLabel(cmd: (typeof commands)[number]): string {
    return cmd.label ? cmd.label() : t(cmd.labelKey)
  }

  function handleSelect(commandId: string): void {
    closePalette()
    void executeCommand(commandId)
  }

  function handleInputContextMenu(e: MouseEvent): void {
    e.preventDefault()
    void showTextInputContextMenu()
  }
</script>

<Command.Dialog
  open={isPaletteOpen()}
  onOpenChange={(v) => setPaletteOpen(v)}
  title={t('commandPalette.placeholder')}
>
  <Command.Input
    placeholder={t('commandPalette.placeholder')}
    oncontextmenu={handleInputContextMenu}
  />
  <Command.List>
    <Command.Empty>{t('commandPalette.empty')}</Command.Empty>
    {#each grouped as [category, cmds] (category)}
      <Command.Group heading={t(category)}>
        {#each cmds as cmd (cmd.id)}
          <Command.Item
            value={getLabel(cmd)}
            keywords={cmd.keywords}
            disabled={!isCommandEnabled(cmd)}
            onSelect={() => handleSelect(cmd.id)}
          >
            {#if cmd.icon}
              <cmd.icon />
            {/if}
            {getLabel(cmd)}
            {@const shortcut = getEffectiveShortcut(cmd)}
            {#if shortcut}
              <Command.Shortcut>
                {formatCombo(shortcut)}
              </Command.Shortcut>
            {/if}
          </Command.Item>
        {/each}
      </Command.Group>
    {/each}
  </Command.List>
</Command.Dialog>
