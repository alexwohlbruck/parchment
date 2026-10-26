import { describe, expect, test } from 'vitest'
import { buildNavRoute } from './nav-route'
import { hazardCallouts, routeHazardCallouts } from './hazard-callouts'
import { cityDrive } from './test-routes'
import type { RouteHazard } from '@/types/directions.types'

const at = { lat: 0, lng: 0 }
const hazard = (kind: RouteHazard['kind'], startDistance: number, severity: RouteHazard['severity'] = 'high'): RouteHazard =>
  ({ kind, severity, startDistance, coordinate: at })

const routeWith = (hazards: RouteHazard[]) => buildNavRoute([{ ...cityDrive(), hazards }])
const kindsAt = (route: ReturnType<typeof routeWith>, s: number, turnAt: number | null = null) =>
  hazardCallouts(route, s, 5, turnAt).map(c => `${c.hazard.kind}@${c.hazard.startDistance}`)

describe('hazardCallouts', () => {
  test('alertable hazards ahead, nearest labelled and the rest compact', () => {
    const route = routeWith([hazard('steps', 50), hazard('crosswalk', 120, 'medium'), hazard('ford', 150), hazard('steps', 200)])
    const callouts = hazardCallouts(route, 100, 5, null)
    expect(callouts.map(c => [c.hazard.kind, c.tone, c.compact])).toEqual([
      ['ford', 'danger', false],
      ['steps', 'caution', true],
    ])
  })

  test('lights and rail crossings are left to the signs on the line', () => {
    const route = routeWith([hazard('traffic_signals', 120, 'low'), hazard('rail_crossing', 150), hazard('sharp_curve', 200)])
    expect(kindsAt(route, 100)).toEqual(['sharp_curve@200'])
  })

  test('a bubble beside a sign gives way to it', () => {
    const route = routeWith([hazard('crosswalk', 105), hazard('rail_crossing', 120), hazard('crosswalk', 135), hazard('steps', 200)])
    expect(kindsAt(route, 100)).toEqual(['steps@200'])
  })

  test('caps the count and the range, which grows with speed', () => {
    const route = routeWith([100, 150, 200, 250, 700].map(s => hazard('steep_grade', s)))
    expect(kindsAt(route, 0)).toEqual(['steep_grade@100', 'steep_grade@150', 'steep_grade@200'])
    expect(hazardCallouts(route, 300, 5, null)).toEqual([])
    expect(hazardCallouts(route, 300, 15, null).map(c => c.hazard.startDistance)).toEqual([700])
  })

  test('stays clear of the turn callout and crosswalks folded into a turn', () => {
    const route = routeWith([hazard('steps', 590), hazard('crosswalk', 615), hazard('sharp_curve', 700)])
    expect(kindsAt(route, 500, 600)).toEqual(['sharp_curve@700'])
  })

  test('hazards bunched together show once', () => {
    const route = routeWith([hazard('crosswalk', 100), hazard('crosswalk', 110), hazard('steps', 140)])
    expect(kindsAt(route, 0)).toEqual(['crosswalk@100', 'steps@140'])
  })
})

describe('routeHazardCallouts', () => {
  test('every bubble left on the route, icon only, past any range', () => {
    const route = routeWith([hazard('steps', 50), hazard('ford', 150), hazard('rail_crossing', 400), hazard('steep_grade', 900)])
    expect(routeHazardCallouts(route, 100, null).map(c => [c.hazard.kind, c.compact])).toEqual([
      ['ford', true],
      ['steep_grade', true],
    ])
  })

  test('keeps clear of signs and the turn callout', () => {
    const route = routeWith([hazard('crosswalk', 105), hazard('traffic_signals', 120, 'low'), hazard('steps', 590), hazard('sharp_curve', 900)])
    expect(routeHazardCallouts(route, 0, 600).map(c => c.hazard.startDistance)).toEqual([900])
  })
})
