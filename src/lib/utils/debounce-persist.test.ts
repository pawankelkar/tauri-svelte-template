import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createDebouncedPersist } from './debounce-persist'

describe('createDebouncedPersist', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('does not call saveFn immediately on schedule', () => {
    const saveFn = vi.fn().mockResolvedValue(undefined)
    const dp = createDebouncedPersist(saveFn, 500)

    dp.schedule()
    expect(saveFn).not.toHaveBeenCalled()
  })

  it('calls saveFn after delay', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined)
    const dp = createDebouncedPersist(saveFn, 500)

    dp.schedule()
    await vi.advanceTimersByTimeAsync(500)
    expect(saveFn).toHaveBeenCalledOnce()
  })

  it('debounces multiple schedule calls', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined)
    const dp = createDebouncedPersist(saveFn, 500)

    dp.schedule()
    await vi.advanceTimersByTimeAsync(200)
    dp.schedule()
    await vi.advanceTimersByTimeAsync(200)
    dp.schedule()
    await vi.advanceTimersByTimeAsync(500)

    expect(saveFn).toHaveBeenCalledOnce()
  })

  it('flush resolves pending timer immediately', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined)
    const dp = createDebouncedPersist(saveFn, 500)

    dp.schedule()
    await dp.flush()
    expect(saveFn).toHaveBeenCalledOnce()
  })

  it('flush resolves immediately when nothing is pending', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined)
    const dp = createDebouncedPersist(saveFn, 500)

    await dp.flush()
    expect(saveFn).not.toHaveBeenCalled()
  })
})
