/**
 * A debounced, last-one-wins request: `run(input)` waits `delay` ms, calls
 * `fetcher`, and only the newest call's answer ever lands in `value` — so
 * typing fast into a search field cannot paint stale results over fresh
 * ones. Used by the search, quick open and outline panels.
 */
import { describeError } from '$lib/core-error'

export interface LatestRequest<I, T> {
  readonly value: T
  readonly loading: boolean
  readonly error: string | null
  /** Schedules a request for `input` (0 ms `delay` runs on the next tick). */
  run(input: I, options?: { immediate?: boolean }): void
  /** Drops any pending request and resets `value`. */
  reset(): void
  cancel(): void
}

export function createLatestRequest<I, T>(
  fetcher: (input: I) => Promise<T>,
  initial: T,
  delay: number,
): LatestRequest<I, T> {
  let value = $state<T>(initial)
  let loading = $state(false)
  let error = $state<string | null>(null)
  let seq = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  async function perform(input: I, mine: number): Promise<void> {
    loading = true
    try {
      const result = await fetcher(input)
      if (mine !== seq) return
      value = result
      error = null
    } catch (e) {
      if (mine !== seq) return
      error = describeError(e)
    } finally {
      if (mine === seq) loading = false
    }
  }

  return {
    get value() {
      return value
    },
    get loading() {
      return loading
    },
    get error() {
      return error
    },
    run(input, options = {}) {
      clearTimeout(timer)
      const mine = ++seq
      if (options.immediate) {
        void perform(input, mine)
        return
      }
      timer = setTimeout(() => void perform(input, mine), delay)
    },
    reset() {
      clearTimeout(timer)
      seq++
      value = initial
      loading = false
      error = null
    },
    cancel() {
      clearTimeout(timer)
      seq++
      loading = false
    },
  }
}
