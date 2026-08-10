<script lang="ts">
	import { Switch as SwitchPrimitive } from "bits-ui";
	import { cn } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		checked = $bindable(false),
		class: className,
		...restProps
	}: SwitchPrimitive.RootProps = $props();
</script>

<SwitchPrimitive.Root
	bind:ref
	bind:checked
	data-slot="switch"
	class={cn(
		// The unchecked track leans on the text-muted token rather than
		// border/input: those sit almost on the page background in many dark
		// themes, leaving an invisible track. text-muted carries the engine's
		// contrast floor against the background, so a 40% mix of it stays a
		// clearly visible pill in every theme.
		"peer data-[state=checked]:bg-primary data-[state=unchecked]:bg-muted-foreground/40 focus-visible:border-ring focus-visible:ring-ring/50 inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
		className
	)}
	{...restProps}
>
	<SwitchPrimitive.Thumb
		data-slot="switch-thumb"
		class={cn(
			"bg-background dark:data-[state=unchecked]:bg-foreground dark:data-[state=checked]:bg-primary-foreground pointer-events-none block size-4 rounded-full ring-0 transition-transform data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0"
		)}
	/>
</SwitchPrimitive.Root>
