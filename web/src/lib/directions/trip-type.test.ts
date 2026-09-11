import { describe, it, expect } from 'vitest'
import { longestTransitSegment, tripType } from './trip-type'

describe('tripType', () => {
  it('labels by combination, not by the longest mode', () => {
    expect(
      tripType([
        { mode: 'walking', duration: 600 },
        { mode: 'transit', duration: 400 },
        { mode: 'walking', duration: 500 },
      ]).key,
    ).toBe('transitWalking')
  })

  it('treats short access walks as part of riding transit', () => {
    expect(
      tripType([
        { mode: 'walking', duration: 120 },
        { mode: 'transit', duration: 1500 },
        { mode: 'walking', duration: 100 },
      ]).key,
    ).toBe('transit')
  })

  it('excludes an absorbed wait from the walking total', () => {
    // 960s of walk segments, but 300s of it is waiting — under the threshold.
    expect(
      tripType([
        { mode: 'walking', duration: 960, waitSeconds: 300 },
        { mode: 'transit', duration: 1500 },
      ]).key,
    ).toBe('transit')
  })

  it('names driving to transit Park & Ride', () => {
    expect(
      tripType([
        { mode: 'driving', duration: 600 },
        { mode: 'transit', duration: 900 },
      ]).key,
    ).toBe('parkAndRide')
  })

  it('distinguishes shared mobility from owned vehicles', () => {
    expect(
      tripType([
        { mode: 'cycling', duration: 900, sharedMobilityDetails: { vehicleType: 'bike' } },
      ]).key,
    ).toBe('bikeshare')
    expect(
      tripType([
        { mode: 'cycling', duration: 900, sharedMobilityDetails: { vehicleType: 'scooter' } },
      ]).key,
    ).toBe('scootershare')
    expect(tripType([{ mode: 'cycling', duration: 900 }]).key).toBe('cycling')
  })

  it('takes its icon from transit whenever transit is involved', () => {
    expect(
      tripType([
        { mode: 'transit', duration: 900 },
        { mode: 'cycling', duration: 300, sharedMobilityDetails: { vehicleType: 'bike' } },
      ]),
    ).toEqual({ key: 'transitBikeShare', iconMode: 'transit' })
  })
})

describe('longestTransitSegment', () => {
  it('picks the longest ride, ignoring other modes', () => {
    const seg = longestTransitSegment([
      { mode: 'walking', duration: 9999 },
      { mode: 'transit', duration: 300 },
      { mode: 'transit', duration: 800 },
    ])
    expect(seg?.duration).toBe(800)
  })

  it('is null when nothing is ridden', () => {
    expect(longestTransitSegment([{ mode: 'walking', duration: 300 }])).toBeNull()
  })
})
