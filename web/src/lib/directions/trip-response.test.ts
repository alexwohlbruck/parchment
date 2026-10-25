import { expect, test } from 'vitest'
import { mapCandidate } from './trip-response'

const segment = (extra: object) => ({
  mode: 'driving',
  startTime: '2026-10-25T12:00:00Z',
  endTime: '2026-10-25T12:10:00Z',
  duration: 600,
  distance: 5000,
  geometry: [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }],
  instructions: [],
  ...extra,
})

const candidate = (segments: object[]) => ({
  rank: 1,
  trip: { requestId: 'r', segments, tripStats: { totalDuration: 600, totalDistance: 5000 }, earliestStartTime: '2026-10-25T12:00:00Z', latestEndTime: '2026-10-25T12:10:00Z' },
})

test('keeps the lanes a driven segment was planned with', () => {
  const laneGeometry = { coordinates: [[0, 0], [1, 0]], measures: [0, 5000] }
  const lanePlan = [{ instruction: 1, lanes: [] }]
  const [mapped] = mapCandidate(candidate([segment({ drivingSide: 'left', laneGeometry, lanePlan })]), 0).segments
  expect(mapped).toMatchObject({ drivingSide: 'left', laneGeometry, lanePlan })
})

test('flattens multimodal segments and reads transit details', () => {
  const ride = segment({ mode: 'transit', details: { transitDetails: { shortName: 'M22', headsign: 'Lower East Side', stops: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] } } })
  const trip = mapCandidate(candidate([segment({ mode: 'multi', details: { multimodalSegments: [segment({ mode: 'walking' }), ride] } })]), 0)
  expect(trip.segments.map((s: { mode: string }) => s.mode)).toEqual(['walking', 'transit'])
  expect(trip.segments[1]).toMatchObject({ lineName: 'M22', headsign: 'Lower East Side', intermediateStops: [{ name: 'b' }] })
})
