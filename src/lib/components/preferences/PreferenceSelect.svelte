<script lang="ts">
  import * as Select from '$lib/components/ui/select'
  import { Label } from '$lib/components/ui/label'

  /**
   * One labelled dropdown row in the Preferences dialog.
   *
   * Every pane needs the same four pieces — a label, an optional description,
   * a trigger showing the current option's text, and the option list — so they
   * live here rather than being retyped per pane.
   *
   * This component is deliberately dumb: it owns no state and does not know
   * about the preferences store. Panes decide where `value` comes from and
   * what `onValueChange` does, which is what lets AdvancedPane use it for a
   * throwaway local `$state` while AppearancePane wires it to the theme store.
   */

  interface SelectOption {
    value: string
    label: string
  }

  let {
    id,
    label,
    description,
    value,
    options,
    onValueChange,
  }: {
    id: string
    label: string
    description?: string
    value: string
    options: SelectOption[]
    onValueChange: (value: string) => void
  } = $props()

  const selectedLabel = $derived(
    options.find((o) => o.value === value)?.label ?? '',
  )
</script>

<div class="space-y-2">
  <Label for={id}>{label}</Label>
  {#if description}
    <p class="text-muted-foreground text-sm">{description}</p>
  {/if}
  <Select.Root type="single" {value} {onValueChange}>
    <Select.Trigger {id} class="w-[240px]">
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
