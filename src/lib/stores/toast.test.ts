import { describe, it, expect, vi, beforeEach } from 'vitest'

const sonnerToast = Object.assign(vi.fn(), {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  dismiss: vi.fn(),
})

vi.mock('svelte-sonner', () => ({ toast: sonnerToast }))

const { toast } = await import('./toast')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('toast wrapper', () => {
  it.each(['success', 'error', 'info', 'warning'] as const)(
    'forwards %s to svelte-sonner unchanged',
    (level) => {
      const options = { description: 'details', duration: 1000 }
      toast[level]('hello', options)
      expect(sonnerToast[level]).toHaveBeenCalledWith('hello', options)
    },
  )

  it('forwards message to the default sonner export', () => {
    toast.message('hello')
    expect(sonnerToast).toHaveBeenCalledWith('hello', undefined)
  })

  it('passes an action through untouched', () => {
    const action = { label: 'Undo', onClick: vi.fn() }
    toast.success('moved', { action })
    expect(sonnerToast.success).toHaveBeenCalledWith('moved', { action })
  })

  it('forwards dismiss', () => {
    toast.dismiss('some-id')
    expect(sonnerToast.dismiss).toHaveBeenCalledWith('some-id')
  })
})
