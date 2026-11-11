import { describe, expect, test } from 'vitest'
import { stripX, tripStrip, type StripSegment } from './trip-strip'

const t = (minute: number) => new Date(Date.UTC(2026, 10, 11, 15, minute)).toISOString()
const line = (from: number, to: number, points = 10) =>
  Array.from({ length: points }, (_, i) => ({ lat: 35 + i * 0.001, lng: -80, elevation: from + ((to - from) * i) / (points - 1) }))

const ride: StripSegment = { mode: 'cycling', startTime: t(0), endTime: t(10), duration: 600, distance: 1000, totalElevationGain: 30, geometry: line(200, 230) }
const train: StripSegment = { mode: 'transit', startTime: t(10), endTime: t(40), duration: 1800, waitSeconds: 300, distance: 15000, geometry: line(200, 300) }
const walk: StripSegment = { mode: 'walking', startTime: t(40), endTime: t(50), duration: 600, distance: 500, totalElevationGain: 5, geometry: line(220, 225) }

describe('tripStrip', () => {
  test('lays legs out by time, with the wait split off the end', () => {
    const { legs } = tripStrip([ride, train, walk])
    expect(legs.map(l => [l.x0, l.x1, l.xEnd])).toEqual([[0, 0.2, 0.2], [0.2, 0.7, 0.8], [0.8, 1, 1]])
  })

  test('draws elevation only for the legs the traveller powers', () => {
    const { profiles } = tripStrip([ride, train, walk])
    expect(profiles.map(p => p.index)).toEqual([0, 2])
  })

  test('scales every profile against the same ground', () => {
    const { profiles } = tripStrip([ride, train, walk])
    const top = Math.max(...profiles.flatMap(p => p.points.map(q => q.y)))
    const walkTop = Math.max(...profiles[1].points.map(q => q.y))
    expect(top).toBeCloseTo(1, 1)
    expect(walkTop).toBeLessThan(top)
  })

  test('leaves the profile out when there is nothing to climb', () => {
    expect(tripStrip([{ ...ride, totalElevationGain: 3 }]).profiles).toEqual([])
  })

  test('places a hazard where it falls along its leg', () => {
    const hazards = [{ kind: 'steps' as const, severity: 'high' as const, startDistance: 250, coordinate: { lat: 0, lng: 0 } }]
    const { markers } = tripStrip([ride, train, { ...walk, hazards }])
    expect(markers).toEqual([{ index: 2, kind: 'steps', x: expect.closeTo(0.9) }])
  })
})

test('stripX follows a traveller along a leg', () => {
  const segments = [ride, train, walk]
  expect(stripX(tripStrip(segments), segments, 0, 500)).toBeCloseTo(0.1)
})
