import { warn } from '$lib/logger'

export interface DebouncedPersist {
  schedule(): void
  flush(): Promise<void>
}

export function createDebouncedPersist(
  saveFn: () => Promise<void>,
  delayMs: number,
): DebouncedPersist {
  let timer: ReturnType<typeof setTimeout> | null = null
  let inflight: Promise<void> | null = null

  function run(): Promise<void> {
    if (timer) clearTimeout(timer)
    timer = null
    inflight = (async () => {
      try {
        await saveFn()
      } catch (e) {
        warn('Persisting failed:', e)
      } finally {
        inflight = null
      }
    })()
    return inflight
  }

  return {
    schedule() {
      if (timer) clearTimeout(timer)
      timer = setTimeout(run, delayMs)
    },
    flush() {
      if (timer) return run()
      return inflight ?? Promise.resolve()
    },
  }
}
