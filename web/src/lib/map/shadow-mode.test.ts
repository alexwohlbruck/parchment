import { describe, expect, it } from 'vitest'
import { ShadowMode } from '@/types/map.types'
import { shadowStrength, TILT_FADE_PITCH } from './shadow-mode'

describe('shadowStrength', () => {
  it('draws nothing when off, at any pitch', () => {
    expect(shadowStrength(ShadowMode.OFF, 0)).toBe(0)
    expect(shadowStrength(ShadowMode.OFF, 60)).toBe(0)
  })

  it('draws in full when always, flat on included', () => {
    expect(shadowStrength(ShadowMode.ALWAYS, 0)).toBe(1)
    expect(shadowStrength(ShadowMode.ALWAYS, 60)).toBe(1)
  })

  it('hides tilted-only shadows flat on and shows them once tilted', () => {
    const [from, to] = TILT_FADE_PITCH
    expect(shadowStrength(ShadowMode.TILTED, 0)).toBe(0)
    expect(shadowStrength(ShadowMode.TILTED, from)).toBe(0)
    expect(shadowStrength(ShadowMode.TILTED, to)).toBe(1)
    expect(shadowStrength(ShadowMode.TILTED, 60)).toBe(1)
  })

  it('eases tilted-only shadows in rather than popping them on', () => {
    const [from, to] = TILT_FADE_PITCH
    const samples = Array.from({ length: 11 }, (_, i) => shadowStrength(ShadowMode.TILTED, from + ((to - from) * i) / 10))
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThan(samples[i - 1])
      expect(samples[i] - samples[i - 1]).toBeLessThan(0.2)
    }
  })
})
