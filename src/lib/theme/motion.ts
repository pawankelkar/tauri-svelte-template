import type { ReducedMotion } from '$lib/stores/preferences-schema'

/**
 * The one place the 'system' preference resolves to a boolean, shared by the
 * live apply path (stores/theme.svelte.ts) and the pre-mount paint
 * (paint-hint.ts) so the two can never drift.
 */
export function resolveReducedMotion(
  pref: ReducedMotion,
  prefersReduce: boolean,
): boolean {
  return pref === 'system' ? prefersReduce : pref === 'on'
}
