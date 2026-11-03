import { describe, expect, test } from 'vitest'
import { buildNavRoute } from './nav-route'
import { crosswalkAfter, hazardCounts, upcomingHazard } from './hazards'
import { cityDrive, translator } from './test-routes'
import { announcementText } from './phrases'
import en from '@/lib/i18n/en-US.json'
import type { RouteHazard } from '@/types/directions.types'

const at = { lat: 0, lng: 0 }
const hazard = (kind: RouteHazard['kind'], startDistance: number, severity: RouteHazard['severity'] = 'high'): RouteHazard =>
  ({ kind, severity, startDistance, coordinate: at })

function routeWith(hazards: RouteHazard[]) {
  return buildNavRoute([{ ...cityDrive(), hazards }])
}

describe('upcomingHazard', () => {
  test('finds the nearest alertable hazard within range', () => {
    const route = routeWith([hazard('traffic_signals', 200, 'low'), hazard('rail_crossing', 250)])
    expect(upcomingHazard(route, 120, 12)?.hazard.kind).toBe('rail_crossing')
    expect(upcomingHazard(route, 0, 12)).toBeNull()
  })

  test('a signalled crosswalk is covered by its light', () => {
    expect(upcomingHazard(routeWith([hazard('crosswalk', 150, 'medium')]), 100, 12)).toBeNull()
  })

  test('a crosswalk just past a turn is left to the turn prompt', () => {
    const route = routeWith([hazard('crosswalk', 615)])
    expect(upcomingHazard(route, 580, 12)).toBeNull()
    expect(crosswalkAfter(route, route.steps[1])?.startDistance).toBe(615)
  })
})

describe('bike lane changes', () => {
  test('are announced ahead of a rider', () => {
    const route = routeWith([hazard('bike_lane_end', 300, 'medium')])
    const ahead = upcomingHazard(route, 250, 5)!
    expect(announcementText({ kind: 'hazard', ...ahead }, false, translator(en))).toBe('Bike lane ends ahead, merge with traffic')
  })
})

describe('hazardCounts', () => {
  test('groups by kind, most common first', () => {
    expect(hazardCounts([hazard('crosswalk', 1), hazard('traffic_signals', 2), hazard('traffic_signals', 3)])).toEqual([
      { kind: 'traffic_signals', count: 2 },
      { kind: 'crosswalk', count: 1 },
    ])
  })
})
