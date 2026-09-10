import { describe, it, expect } from 'vitest'
import { tripChips } from './trip-chips'

describe('tripChips', () => {
  it('renders one chip per leg, in order', () => {
    const chips = tripChips([
      { mode: 'walking', duration: 300 },
      { mode: 'transit', lineName: 'B45', routeType: 'bus', lineColor: '0039A6' },
      { mode: 'walking', duration: 120 },
    ])
    expect(chips).toEqual([
      { kind: 'walk', minutes: 5 },
      {
        kind: 'transit',
        label: 'B45',
        routeType: 'bus',
        color: '0039A6',
        textColor: undefined,
      },
      { kind: 'walk', minutes: 2 },
    ])
  })

  it('counts only the moving part of a walk that absorbed a wait', () => {
    const chips = tripChips([
      { mode: 'walking', duration: 420, waitSeconds: 165 },
    ])
    expect(chips).toEqual([{ kind: 'walk', minutes: 4 }])
  })

  it('drops a walk too short to round to a minute', () => {
    const chips = tripChips([
      { mode: 'walking', duration: 20 },
      { mode: 'transit', lineName: 'Q', routeType: 'subway' },
    ])
    expect(chips).toHaveLength(1)
    expect(chips[0].kind).toBe('transit')
  })

  it('merges adjacent walks into one chip', () => {
    const chips = tripChips([
      { mode: 'walking', duration: 300 },
      { mode: 'walking', duration: 180 },
    ])
    expect(chips).toEqual([{ kind: 'walk', minutes: 8 }])
  })

  it('gives a transit leg with no line name an unlabelled chip', () => {
    const chips = tripChips([{ mode: 'transit', routeType: 'ferry' }])
    expect(chips[0]).toMatchObject({ kind: 'transit', label: null })
  })

  it('carries minutes on vehicle legs', () => {
    const chips = tripChips([
      { mode: 'cycling', duration: 900 },
      { mode: 'driving', duration: 600 },
    ])
    expect(chips).toEqual([
      { kind: 'vehicle', mode: 'cycling', minutes: 15 },
      { kind: 'vehicle', mode: 'driving', minutes: 10 },
    ])
  })
})
