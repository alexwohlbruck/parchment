import { describe, expect, it } from 'vitest'
import { navigationSpeechRate, speechDuration } from './speech-rate'

describe('navigation speech rate', () => {
  it('keeps the preferred rate with enough time or no estimate', () => {
    expect(navigationSpeechRate('Turn left', 1.15, 20)).toBe(1.15)
    expect(navigationSpeechRate('Turn left', 0.75)).toBe(0.75)
  })
  it('speeds up long instructions in a short maneuver window within bounds', () => {
    expect(navigationSpeechRate('In two hundred feet turn right then immediately keep left', 1, 4)).toBeGreaterThan(1)
    expect(navigationSpeechRate('In two hundred feet turn right then immediately keep left', 1, 2)).toBe(1.5)
  })
  it('estimates duration at the selected speed and restores it after a busy window', () => {
    const text = 'In two hundred feet turn right then immediately keep left'
    expect(speechDuration(text, 0.75)).toBeGreaterThan(speechDuration(text, 1.5))
    expect(speechDuration('', 1)).toBe(0)
    expect(navigationSpeechRate(text, 1.15, 3)).toBe(1.5)
    expect(navigationSpeechRate(text, 1.15, 30)).toBe(1.15)
  })
  it('bounds invalid preferences and ignores unusable time estimates', () => {
    expect(navigationSpeechRate('Turn left', NaN, -1)).toBe(1)
    expect(navigationSpeechRate('Turn left', 10, Infinity)).toBe(1.5)
  })
})
