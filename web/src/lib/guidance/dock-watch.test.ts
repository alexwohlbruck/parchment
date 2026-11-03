import { describe, expect, test } from 'vitest'
import { dockRisk, pollInterval, projectAvailability, switchStation, watchedDock } from './dock-watch'

const minute = 60_000
const samples = (...counts: number[]) => counts.map((available, i) => ({ t: i * minute, available }))

describe('projectAvailability', () => {
  test('follows the trend to the arrival time', () => {
    expect(projectAvailability(samples(10, 8, 6), 6 * minute)).toBeCloseTo(0)
    expect(projectAvailability(samples(4, 4, 4), 10 * minute)).toBe(4)
  })
  test('never goes below zero, and a single sample is taken as is', () => {
    expect(projectAvailability(samples(3, 1), 20 * minute)).toBe(0)
    expect(projectAvailability(samples(5), 20 * minute)).toBe(5)
  })
})

describe('dockRisk', () => {
  test('ok, at risk when the trend runs short by arrival, gone at zero', () => {
    expect(dockRisk(samples(12, 12), 5 * minute)).toBe('ok')
    expect(dockRisk(samples(9, 7, 5), 5 * minute)).toBe('at-risk')
    expect(dockRisk(samples(2, 0), 2 * minute)).toBe('gone')
  })
})

describe('watchedDock', () => {
  const walk = { mode: 'walking', geometry: [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }] }
  const ride = {
    mode: 'cycling',
    ownership: 'shared',
    geometry: [{ lat: 0, lng: 1 }, { lat: 0, lng: 2 }],
    sharedMobilityDetails: { stationName: 'W 3 St', toStationName: 'College St' },
  }
  test('watches the pickup bike while walking to it', () => {
    expect(watchedDock([walk, ride, walk], 0)).toEqual({ boundary: 0, need: 'bike', location: { lat: 0, lng: 1 }, name: 'W 3 St' })
  })
  test('watches the dropoff dock while riding', () => {
    expect(watchedDock([walk, ride, walk], 1)).toEqual({ boundary: 1, need: 'dock', location: { lat: 0, lng: 2 }, name: 'College St' })
  })
  test('nothing to watch on a personal bike', () => {
    expect(watchedDock([walk, { ...ride, ownership: 'personal' }], 1)).toBeNull()
  })
})

describe('pollInterval', () => {
  test('every 30 s once close, else every minute', () => {
    expect(pollInterval(3000, 900)).toBe(60_000)
    expect(pollInterval(800, 900)).toBe(30_000)
    expect(pollInterval(3000, 200)).toBe(30_000)
  })
})

describe('switchStation', () => {
  test('replans into and out of the new station, renaming it on both', () => {
    type Segment = { mode: string; ownership?: string; geometry?: { lat: number; lng: number }[]; end?: { label: string }; sharedMobilityDetails?: { toStationName?: string } }
    const ride: Segment = { mode: 'cycling', ownership: 'shared', sharedMobilityDetails: { toStationName: 'Full St' } }
    const walk: Segment = { mode: 'walking', end: { label: 'Home' } }
    const station = { name: 'College St', location: { lat: 1, lng: 1 } }
    const [into, outOf, ...rest] = switchStation<Segment>([ride, walk, { mode: 'walking' }], 0, { geometry: [] }, { geometry: [station.location] }, station)
    expect(into).toMatchObject({ geometry: [], sharedMobilityDetails: { toStationName: 'College St' } })
    expect(outOf).toMatchObject({ geometry: [station.location], end: { label: 'Home' } })
    expect(rest).toEqual([{ mode: 'walking' }])
  })
})
