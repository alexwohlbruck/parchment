import { describe, expect, it } from 'vitest'
import {
  autoPowerSaver,
  DEFAULT_POWER_SAVER_AUTO,
  isStronger,
  locationWatchOptions,
  mapRenderBudget,
  pollInterval,
  strongerSaver,
} from './power-saver'

const auto = { ...DEFAULT_POWER_SAVER_AUTO, enabled: true }

describe('autoPowerSaver', () => {
  it('stays off while disabled', () => {
    expect(autoPowerSaver(DEFAULT_POWER_SAVER_AUTO, { level: 0.05, charging: false })).toBe('off')
  })

  it('stays off without a battery reading', () => {
    expect(autoPowerSaver(auto, null)).toBe('off')
  })

  it('stays off while charging', () => {
    expect(autoPowerSaver(auto, { level: 0.05, charging: true })).toBe('off')
  })

  it('steps up as the battery runs down', () => {
    expect(autoPowerSaver(auto, { level: 0.5, charging: false })).toBe('off')
    expect(autoPowerSaver(auto, { level: 0.2, charging: false })).toBe('normal')
    expect(autoPowerSaver(auto, { level: 0.1, charging: false })).toBe('extreme')
  })
})

describe('strongerSaver', () => {
  it('keeps the stronger of a choice and the battery', () => {
    expect(strongerSaver('normal', 'off')).toBe('normal')
    expect(strongerSaver('off', 'extreme')).toBe('extreme')
    expect(strongerSaver('extreme', 'normal')).toBe('extreme')
  })
})

describe('locationWatchOptions', () => {
  it('drops to coarse location while saving', () => {
    expect(locationWatchOptions('normal', false).enableHighAccuracy).toBe(false)
  })

  it('keeps full accuracy during navigation', () => {
    expect(locationWatchOptions('extreme', true).enableHighAccuracy).toBe(true)
  })
})

describe('isStronger', () => {
  it('only counts a step up', () => {
    expect(isStronger('normal', 'off')).toBe(true)
    expect(isStronger('normal', 'normal')).toBe(false)
    expect(isStronger('normal', 'extreme')).toBe(false)
  })
})

describe('mapRenderBudget', () => {
  it('draws fewer pixels and frames the harder it saves', () => {
    const [off, normal, extreme] = (['off', 'normal', 'extreme'] as const).map(mapRenderBudget)
    expect(off.minFrameMs).toBe(0)
    expect(normal.maxPixelRatio).toBeLessThan(off.maxPixelRatio)
    expect(extreme.maxPixelRatio).toBeLessThan(normal.maxPixelRatio)
    expect(normal.minFrameMs).toBeGreaterThan(0)
  })
})

describe('pollInterval', () => {
  it('keeps the base rate when off and slows it while saving', () => {
    expect(pollInterval(5000, 'off')).toBe(5000)
    expect(pollInterval(5000, 'normal')).toBeGreaterThan(5000)
    expect(pollInterval(5000, 'extreme')).toBeGreaterThan(pollInterval(5000, 'normal'))
  })
})
