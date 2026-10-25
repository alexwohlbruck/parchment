import { describe, expect, test } from 'vitest'
import { buildNavRoute, pointAt, stepIndexAt } from './nav-route'
import { describeHandoff, dueHandoff } from './handoff'
import { polyline } from './test-routes'
import type { PuckState } from './guidance-engine'

const drive = polyline([[0, 500]])
const walk = polyline([[90, 200]], drive.at(-1))
const route = buildNavRoute([
  { mode: 'driving', geometry: drive },
  { mode: 'walking', geometry: walk },
])
const segments = [
  { mode: 'driving', duration: 60 },
  { mode: 'walking', duration: 180, end: { label: 'Cafe' } },
]
const puck = (s: number, speed = 10): PuckState => ({ position: pointAt(route, s), bearing: 0, s, speed, snapped: true, stepIndex: stepIndexAt(route, s) })

describe('describeHandoff', () => {
  test.each([
    [{ mode: 'driving' }, { mode: 'walking' }, 'park'],
    [{ mode: 'cycling', ownership: 'shared' }, { mode: 'walking' }, 'dock-bike'],
    [{ mode: 'biking' }, { mode: 'walking' }, 'lock-bike'],
    [{ mode: 'walking' }, { mode: 'cycling', ownership: 'shared' }, 'unlock-bike'],
    [{ mode: 'walking' }, { mode: 'driving' }, 'get-in-car'],
    [{ mode: 'walking' }, { mode: 'transit' }, 'board'],
  ])('%o → %o is %s', (from, to, kind) => {
    expect(describeHandoff([from, to], 0)?.kind).toBe(kind)
  })

  test('docking names the destination station and its free docks', () => {
    const handoff = describeHandoff(
      [{ mode: 'cycling', ownership: 'shared', sharedMobilityDetails: { toStationName: 'W 52 St', availableDocks: 6 } }, { mode: 'walking' }],
      0,
    )
    expect(handoff).toMatchObject({ station: 'W 52 St', docks: 6 })
  })
})

describe('dueHandoff', () => {
  test('appears near the end of a segment, not before', () => {
    expect(dueHandoff(route, puck(300), segments, 0)).toBeNull()
    expect(dueHandoff(route, puck(470), segments, 0)).toMatchObject({ kind: 'park', nextDuration: 180, nextEnd: 'Cafe' })
  })

  test('appears early once a drive has stopped close to its end', () => {
    expect(dueHandoff(route, puck(300, 0.5), segments, 25)?.kind).toBe('park')
  })

  test('never for the last segment', () => {
    expect(dueHandoff(route, puck(690, 1), segments, 30)).toBeNull()
  })
})
