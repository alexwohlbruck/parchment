import { describe, expect, test } from 'vitest'
import { buildNavRoute, pointAt, stepIndexAt, type NavSegmentInput } from './nav-route'
import { MISSED_GRACE_MS, minutesUntil, rideStops, secondsToStop, walksToStop, stageEvent, timetabledRemaining, transitStage, withBoardingStep, type TransitSegmentInput } from './transit-progress'
import { polyline } from './test-routes'
import type { PuckState } from './guidance-engine'

const walk = polyline([[0, 300]])
const ride = polyline([[90, 2000]], walk.at(-1))
const walkOff = polyline([[0, 200]], ride.at(-1))
const route = buildNavRoute([
  { mode: 'walking', geometry: walk },
  { mode: 'transit', geometry: ride },
  { mode: 'walking', geometry: walkOff },
])
const departure = Date.parse('2026-10-25T12:10:00Z')
const segments: TransitSegmentInput[] = [
  { mode: 'walking' },
  {
    mode: 'transit',
    startTime: new Date(departure),
    lineName: '16',
    departureStop: { name: 'Tryon', location: ride[0] },
    intermediateStops: [
      { name: 'Stonewall', location: pointAt(route, 800) },
      { name: 'Morehead', location: pointAt(route, 1500) },
    ],
    arrivalStop: { name: 'Carson', location: ride.at(-1), arrivalTime: '2026-10-25T12:18:00Z' },
  },
  { mode: 'walking' },
]
const rides = segments.map((segment, i) => (segment.mode === 'transit' ? rideStops(route, i, segment) : null))
const puck = (s: number, speed = 1.4, snapped = true): PuckState => ({
  position: pointAt(route, s), bearing: 0, s, speed, snapped, stepIndex: stepIndexAt(route, s), estimated: false,
})
const stage = (s: number, speed?: number, now = departure - 300_000, snapped?: boolean) =>
  transitStage(route, segments, rides, puck(s, speed, snapped), now)

describe('rideStops', () => {
  test('places every stop on the ride in order', () => {
    expect(rides[1]?.map(stop => [stop.name, Math.round(stop.s)])).toEqual([
      ['Tryon', 300], ['Stonewall', 800], ['Morehead', 1500], ['Carson', 2300],
    ])
  })
})

describe('transitStage', () => {
  test('walks to the stop, then waits at it', () => {
    expect(stage(100)).toMatchObject({ kind: 'to-stop', segmentIndex: 1, stop: 'Tryon', departureMs: departure })
    expect(stage(280, 0)).toMatchObject({ kind: 'wait' })
    expect(stage(305, 0)).toMatchObject({ kind: 'wait' })
  })

  test('still at the stop well after departure means the vehicle was missed', () => {
    expect(stage(300, 0, departure + MISSED_GRACE_MS + 1000)?.kind).toBe('missed-vehicle')
    expect(stage(300, 0, departure + 30_000)?.kind).toBe('wait')
  })

  test('counts down the stops while riding', () => {
    expect(stage(500, 10)).toMatchObject({ kind: 'riding', stopsLeft: 3, nextStop: 'Stonewall', alight: 'Carson' })
    expect(stage(1600, 10)).toMatchObject({ kind: 'riding', stopsLeft: 1, nextStop: 'Carson' })
  })

  test('announces get-off next, then now', () => {
    expect(stageEvent(stage(500, 10)!)).toBeNull()
    expect(stageEvent(stage(1600, 10)!)).toBe('alight-next')
    expect(stageEvent(stage(2200, 8)!)).toBe('alight-now')
  })

  test('carrying on off the route at vehicle speed past the stop is a missed stop', () => {
    expect(stage(2450, 1.4, departure, false)).toBeNull()
    expect(stage(2450, 9)).toBeNull()
    expect(stage(2450, 9, departure, false)).toMatchObject({ kind: 'missed-stop', segmentIndex: 1, alight: 'Carson' })
  })

  test('off the line at walking pace by the alighting stop is getting off, not a missed stop', () => {
    expect(stage(2200, 1.2, departure, false)).toMatchObject({ kind: 'riding', alighting: true })
    expect(stage(2200, 9, departure, false)?.kind).toBe('missed-stop')
    expect(stage(1600, 1.2, departure, false)?.kind).toBe('missed-stop')
  })

  test('arriving at the stop on a bike is not boarding', () => {
    expect(stage(295, 5.5)).toMatchObject({ kind: 'wait' })
  })

  test('cycling on from the stop is not a missed stop', () => {
    const bikeOff = buildNavRoute([
      { mode: 'walking', geometry: walk },
      { mode: 'transit', geometry: ride },
      { mode: 'cycling', geometry: walkOff },
    ])
    expect(transitStage(bikeOff, segments, rides, puck(2450, 6, false), departure)).toBeNull()
  })

  test('leaving the line near the end of the ride is a missed stop', () => {
    expect(stage(2000, 9, departure, false)?.kind).toBe('missed-stop')
  })
})

describe('secondsToStop', () => {
  const stage = { kind: 'to-stop', segmentIndex: 2, stop: 'Tryon', departureMs: departure } as const
  const bikeRoute = buildNavRoute([
    { mode: 'cycling', geometry: polyline([[0, 900]]), duration: 200 },
    { mode: 'walking', geometry: polyline([[0, 100]], polyline([[0, 900]]).at(-1)), duration: 200, waitSeconds: 120 },
    { mode: 'transit', geometry: ride },
  ])

  test('times each segment at its own planned pace, waits left out', () => {
    expect(secondsToStop(bikeRoute, stage as never, 0)).toBeCloseTo(280, 0)
    expect(secondsToStop(bikeRoute, stage as never, 450)).toBeCloseTo(180, 0)
  })

  test('falls back to a pace for the mode when the plan has no time', () => {
    const untimed = buildNavRoute([{ mode: 'cycling', geometry: polyline([[0, 900]]) }, { mode: 'transit', geometry: ride }])
    expect(secondsToStop(untimed, { ...stage, segmentIndex: 1 } as never, 0)).toBeCloseTo(200, 0)
  })

  test('running is an option only on foot', () => {
    expect(walksToStop(bikeRoute, 2)).toBe(true)
    expect(walksToStop(buildNavRoute([{ mode: 'cycling', geometry: walk }, { mode: 'transit', geometry: ride }]), 1)).toBe(false)
  })
})

describe('timetabledRemaining', () => {
  const durations = [240, 480, 150]
  const withArrival = segments.map((segment, i) => (i === 1 ? { ...segment, endTime: '2026-10-25T12:18:00Z' } : segment))
  test('anchors on the ride arrival plus what follows it', () => {
    expect(timetabledRemaining(route, withArrival, durations, 100, departure)).toBe(480 + 150)
  })
  test('none once the last ride is behind', () => {
    expect(timetabledRemaining(route, withArrival, durations, 2400, departure)).toBeNull()
  })
})

describe('withBoardingStep', () => {
  test('gives a ride a boarding step at its first stop', () => {
    const boarded = withBoardingStep<NavSegmentInput & TransitSegmentInput>({ ...segments[1], geometry: ride })
    expect(boarded.instructions).toMatchObject([{ type: 'board', streetName: 'Tryon', coordinate: ride[0] }])
    const routeWithStep = buildNavRoute([{ mode: 'walking', geometry: walk }, boarded])
    expect(routeWithStep.steps.map(step => Math.round(step.startDistance))).toEqual([300])
  })
})

describe('minutesUntil', () => {
  test('rounds up, so a stop still ahead never reads as zero minutes', () => {
    expect(minutesUntil(departure + 61_000, departure)).toBe(2)
    expect(minutesUntil(departure + 45_000, departure)).toBe(1)
  })

  test('says nothing once arrival is imminent, overdue or unknown', () => {
    expect(minutesUntil(departure + 20_000, departure)).toBeNull()
    expect(minutesUntil(departure - 60_000, departure)).toBeNull()
    expect(minutesUntil(null, departure)).toBeNull()
  })
})
