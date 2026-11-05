import { describe, it, expect } from 'vitest'
import { stableTripKeys, tripSignature } from './trip-signature'

describe('tripSignature', () => {
  it('orders transit lines and skips walking', () => {
    expect(
      tripSignature([
        { mode: 'walking' },
        { mode: 'transit', lineName: 'B44-SBS' },
        { mode: 'walking' },
        { mode: 'transit', lineName: 'B38' },
        { mode: 'walking' },
      ]),
    ).toBe('b44-sbs>b38')
  })

  it('distinguishes shared rides from personal bikes', () => {
    expect(
      tripSignature([
        { mode: 'walking' },
        { mode: 'cycling', ownership: 'shared', sharedMobilityDetails: { vehicleType: 'bike' } },
        { mode: 'walking' },
      ]),
    ).toBe('share-bike')
    expect(
      tripSignature([{ mode: 'cycling' }, { mode: 'walking' }]),
    ).toBe('bike')
  })

  it('labels pure walking trips', () => {
    expect(tripSignature([{ mode: 'walking' }])).toBe('walk')
  })

  it('mixed park-and-ride style trips chain tokens', () => {
    expect(
      tripSignature([
        { mode: 'driving' },
        { mode: 'walking' },
        { mode: 'transit', lineName: '4' },
      ]),
    ).toBe('drive>4')
  })

  it('is stable regardless of id or timing fields', () => {
    const a = tripSignature([
      { mode: 'transit', lineName: 'G' },
      { mode: 'cycling', ownership: 'shared', sharedMobilityDetails: { vehicleType: 'bike' } },
    ])
    expect(a).toBe('g>share-bike')
  })
})

describe('stableTripKeys', () => {
  it('keys the same itineraries alike across re-plans, numbering repeats', () => {
    const plan = (prefix: string) => [
      { id: `${prefix}-0`, segments: [{ mode: 'transit', lineName: 'A' }] },
      { id: `${prefix}-1`, segments: [{ mode: 'transit', lineName: 'A' }] },
      { id: `${prefix}-2`, segments: [{ mode: 'biking' }] },
    ]
    expect([...stableTripKeys(plan('r1')).values()]).toEqual(['a#0', 'a#1', 'bike#0'])
    expect([...stableTripKeys(plan('r2')).values()]).toEqual([...stableTripKeys(plan('r1')).values()])
  })
})
