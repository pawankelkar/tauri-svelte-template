import { describe, it, expect, afterEach, vi } from 'vitest'
import { createLatestRequest } from './latest-request.svelte'

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

afterEach(() => vi.useRealTimers())

describe('createLatestRequest', () => {
  it('debounces and only lets the newest answer land', async () => {
    vi.useFakeTimers()
    const pending = new Map<string, ReturnType<typeof deferred<string>>>()
    const fetcher = vi.fn((q: string) => {
      const d = deferred<string>()
      pending.set(q, d)
      return d.promise
    })
    const req = createLatestRequest(fetcher, '', 100)

    req.run('a')
    req.run('ab')
    await vi.advanceTimersByTimeAsync(100)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenLastCalledWith('ab')

    req.run('abc', { immediate: true })
    expect(req.loading).toBe(true)
    pending.get('abc')!.resolve('C')
    pending.get('ab')!.resolve('B') // stale, arrives late
    await vi.waitFor(() => expect(req.value).toBe('C'))
    expect(req.loading).toBe(false)
  })

  it('keeps errors from the latest request and clears them on reset', async () => {
    const req = createLatestRequest(
      () => Promise.reject({ kind: 'internal', message: 'boom' }),
      [] as string[],
      0,
    )
    req.run(null, { immediate: true })
    await vi.waitFor(() => expect(req.error).toBeTruthy())
    req.reset()
    expect(req.error).toBeNull()
    expect(req.value).toEqual([])
  })

  it('cancel drops a pending answer', async () => {
    const d = deferred<number>()
    const req = createLatestRequest(() => d.promise, 0, 0)
    req.run(null, { immediate: true })
    req.cancel()
    d.resolve(5)
    await d.promise
    await Promise.resolve()
    expect(req.value).toBe(0)
    expect(req.loading).toBe(false)
  })
})
