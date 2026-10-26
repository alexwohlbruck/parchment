import { describe, expect, it } from 'vitest'
import { displaySpeed, showsLimit, showsSpeedometer, speeding } from './speed-display'

describe('speeding', () => {
  it('is under without a limit or at it', () => {
    expect(speeding(80, null)).toBe('under')
    expect(speeding(50, 50)).toBe('under')
  })

  it('separates a little over from well over', () => {
    expect(speeding(54, 50)).toBe('over')
    expect(speeding(55, 50)).toBe('over')
    expect(speeding(56, 50)).toBe('far-over')
  })
})

describe('speed display', () => {
  it('shows each part only when chosen', () => {
    expect([showsLimit('both'), showsSpeedometer('both')]).toEqual([true, true])
    expect([showsLimit('limit'), showsSpeedometer('limit')]).toEqual([true, false])
    expect([showsLimit('speedometer'), showsSpeedometer('speedometer')]).toEqual([false, true])
    expect([showsLimit('none'), showsSpeedometer('none')]).toEqual([false, false])
  })

  it('converts to the traveller units', () => {
    expect(displaySpeed(10, true)).toBe(36)
    expect(displaySpeed(10, false)).toBe(22)
  })
})
