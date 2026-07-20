import { describe, it, expect, vi, beforeEach } from 'vitest'
import { logger, trace, debug, info, warn, error } from './logger'

describe('logger', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('logs to console with timestamp prefix', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})

    logger.info('test message')

    expect(spy).toHaveBeenCalledOnce()
    const [prefix, message] = spy.mock.calls[0]!
    expect(prefix).toMatch(/^\[.*\] \[INFO\]$/)
    expect(message).toBe('test message')
  })

  it('logs extra args', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    logger.warn('warning', { detail: 'x' })

    expect(spy).toHaveBeenCalledOnce()
    expect(spy.mock.calls[0]![2]).toEqual({ detail: 'x' })
  })

  it('destructured functions retain correct this binding', () => {
    const debugSpy = vi
      .spyOn(console, 'debug')
      .mockImplementation(() => {})
    const infoSpy = vi
      .spyOn(console, 'info')
      .mockImplementation(() => {})
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {})
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {})

    expect(() => trace('t')).not.toThrow()
    expect(() => debug('d')).not.toThrow()
    expect(() => info('i')).not.toThrow()
    expect(() => warn('w')).not.toThrow()
    expect(() => error('e')).not.toThrow()

    expect(debugSpy).toHaveBeenCalledTimes(2) // trace + debug both map to console.debug
    expect(infoSpy).toHaveBeenCalledOnce()
    expect(warnSpy).toHaveBeenCalledOnce()
    expect(errorSpy).toHaveBeenCalledOnce()
  })

  it('uses correct console methods for each level', () => {
    const debugSpy = vi
      .spyOn(console, 'debug')
      .mockImplementation(() => {})
    const infoSpy = vi
      .spyOn(console, 'info')
      .mockImplementation(() => {})
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {})
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {})

    logger.trace('t')
    logger.debug('d')
    logger.info('i')
    logger.warn('w')
    logger.error('e')

    expect(debugSpy).toHaveBeenCalledTimes(2)
    expect(infoSpy).toHaveBeenCalledOnce()
    expect(warnSpy).toHaveBeenCalledOnce()
    expect(errorSpy).toHaveBeenCalledOnce()
  })
})
