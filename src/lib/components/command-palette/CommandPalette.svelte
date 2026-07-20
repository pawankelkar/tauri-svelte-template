<script lang="ts">
  import * as Command from '$lib/components/ui/command'
  import {
    isPaletteOpen,
    setPaletteOpen,
    closePalette,
    listCommands,
    executeCommand,
  } from '$lib/commands'
  import { parseShortcut, type ParsedShortcut } from '$lib/shortcuts'
  import { formatShortcut } from '$lib/platform-strings'
  import { getPlatform } from '$lib/hooks/use-platform.svelte'
  import { showTextInputContextMenu } from '$lib/context-menu'
  import i18n from '$lib/i18n/config'

  type GroupedCommands = Map<string, typeof commands>

  let commands = $derived(listCommands())

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
    return cmd.label ? cmd.label() : i18n.t(cmd.labelKey)
  }

  function getShortcutDisplay(shortcut: string): string {
    const parsed: ParsedShortcut = parseShortcut(shortcut)
    return formatShortcut(getPlatform(), parsed.key, parsed.modifiers)
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
  title={i18n.t('commandPalette.placeholder')}
>
  <Command.Input
    placeholder={i18n.t('commandPalette.placeholder')}
    oncontextmenu={handleInputContextMenu}
  />
  <Command.List>
    <Command.Empty>{i18n.t('commandPalette.empty')}</Command.Empty>
    {#each grouped as [category, cmds] (category)}
      <Command.Group heading={i18n.t(category)}>
        {#each cmds as cmd (cmd.id)}
          <Command.Item
            value={getLabel(cmd)}
            onSelect={() => handleSelect(cmd.id)}
          >
            {getLabel(cmd)}
            {#if cmd.shortcut}
              <Command.Shortcut>
                {getShortcutDisplay(cmd.shortcut)}
              </Command.Shortcut>
            {/if}
          </Command.Item>
        {/each}
      </Command.Group>
    {/each}
  </Command.List>
</Command.Dialog>
