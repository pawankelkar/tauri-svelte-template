import { describe, expect, it } from 'vitest'
import { Effect } from '@tauri-apps/api/window'
import { parseWindowsBuild, pickWindowsEffect } from './window-effects'

describe('pickWindowsEffect', () => {
  it('picks Mica from the first Windows 11 build', () => {
    expect(pickWindowsEffect(22000)).toBe(Effect.Mica)
    expect(pickWindowsEffect(22631)).toBe(Effect.Mica)
  })

  it('picks Acrylic below build 22000', () => {
    expect(pickWindowsEffect(21999)).toBe(Effect.Acrylic)
    expect(pickWindowsEffect(19045)).toBe(Effect.Acrylic)
  })
})

describe('parseWindowsBuild', () => {
  it('reads the build from the third version segment', () => {
    // Windows 11 still reports major 10 — only the build distinguishes it.
    expect(parseWindowsBuild('10.0.22631')).toBe(22631)
    expect(parseWindowsBuild('10.0.19045')).toBe(19045)
  })

  it('degrades to 0 on malformed input', () => {
    expect(parseWindowsBuild('')).toBe(0)
    expect(parseWindowsBuild('10.0')).toBe(0)
    expect(parseWindowsBuild('10.0.beta')).toBe(0)
  })
})
