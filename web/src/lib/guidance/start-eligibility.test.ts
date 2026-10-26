import { describe, expect, test } from 'vitest'
import { projectLatLng } from '@/lib/map/movement-interpolation'
import { corridorMeters, joinPlan, STALE_FIX_MS, startEligibility, type RouteSegment } from './start-eligibility'
import { polyline } from './test-routes'

const NOW = 1_800_000_000_000
const drive: RouteSegment = { mode: 'driving', geometry: polyline([[0, 2000]]) }
const end = drive.geometry!.at(-1)!
const walk: RouteSegment = { mode: 'walking', geometry: polyline([[90, 500]], end) }
const ride: RouteSegment = { mode: 'transit', geometry: polyline([[0, 8000]], walk.geometry!.at(-1)!) }

const fix = (position = drive.geometry![0], accuracy = 10, at = NOW) => ({ position, accuracy, at })
/** A point `metres` east (negative: west) of the drive, `along` metres up it. */
const besideDrive = (metres: number, along = 1000) =>
  projectLatLng(projectLatLng(drive.geometry![0], along, 0, 1), metres, 90, 1)

describe('startEligibility', () => {
  test('navigates from anywhere along the route, not just its start', () => {
    expect(startEligibility([drive], fix(besideDrive(50, 1500)), NOW)).toBe('navigate')
  })

  test('previews when the traveller is away from every part of the route', () => {
    expect(startEligibility([drive], fix(besideDrive(400)), NOW)).toBe('preview')
  })

  test('sizes the corridor by mode', () => {
    const position = projectLatLng(walk.geometry![10], 120, 0, 1)
    expect(startEligibility([walk], fix(position), NOW)).toBe('preview')
    expect(startEligibility([{ ...walk, mode: 'driving' }], fix(position), NOW)).toBe('navigate')
  })

  test('poor accuracy widens the corridor up to a cap', () => {
    expect(startEligibility([drive], fix(besideDrive(200), 80), NOW)).toBe('navigate')
    expect(startEligibility([drive], fix(besideDrive(400), 1000), NOW)).toBe('preview')
    expect(corridorMeters('walking', 5000)).toBe(175)
  })

  test('any segment of a multimodal trip counts, transit rides included', () => {
    const onRide = projectLatLng(ride.geometry![300], 30, 90, 1)
    expect(startEligibility([drive, walk, ride], fix(onRide), NOW)).toBe('navigate')
  })

  test('is unknown without a fix, or with a stale one', () => {
    expect(startEligibility([drive], null, NOW)).toBe('unknown')
    expect(startEligibility([drive], fix(besideDrive(5000), 10, NOW - STALE_FIX_MS - 1), NOW)).toBe('unknown')
  })
})

describe('joinPlan', () => {
  test('follows a fix inside the corridor', () => {
    expect(joinPlan([drive], fix(besideDrive(20)))).toEqual({ kind: 'on-route' })
  })

  test('plans a way onto the nearest segment within reach', () => {
    expect(joinPlan([drive, walk], fix(besideDrive(-1500)))).toEqual({ kind: 'join', segmentIndex: 0 })
  })

  test('waits when the route is too far to join', () => {
    expect(joinPlan([drive], fix(besideDrive(20_000)))).toMatchObject({ kind: 'away' })
  })

  test('cannot plan onto a transit ride', () => {
    const offRide = projectLatLng(ride.geometry![400], 1500, 90, 1)
    expect(joinPlan([drive, walk, ride], fix(offRide))).toMatchObject({ kind: 'away' })
  })
})
