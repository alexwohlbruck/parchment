import { describe, expect, test } from 'vitest'
import type { RouteEdgeSegment, RouteHazard } from '@/types/directions.types'
import { buildNavRoute, type NavRoute } from '../nav-route'
import { upcomingHazard } from '../hazards'
import { cityDrive, translator } from '../test-routes'
import { richInstruction } from './rich-instruction'
import { speechFor, type RichSource } from './rich-announcement'
import { dismountText, voiceText } from './instruction-text'
import { dismountAt } from './dismount'
import en from '@/lib/i18n/en-US.json'
import es from '@/lib/i18n/es-ES.json'

const t = translator(en)
const tEs = translator(es)

/** The city route ridden: right onto Trade Street at 600 m, left onto College Street at 1000 m. */
function ride(edges: Partial<RouteEdgeSegment>[], hazards: RouteHazard[] = []): NavRoute {
  const drive = cityDrive()
  drive.instructions![1].streetName = 'Trade Street'
  return buildNavRoute([{
    ...drive,
    mode: 'cycling',
    edgeSegments: [{ startDistance: 0, endDistance: 598, roadClass: 'residential' }, ...edges].map(e => ({ startDistance: 0, endDistance: 0, ...e })),
    hazards,
  }])
}

const push = (startDistance: number, endDistance: number): RouteHazard =>
  ({ kind: 'dismount', severity: 'low', startDistance, endDistance, coordinate: { lat: 0, lng: 0 } })

const source = (route: NavRoute, from: number): RichSource => ({ route, from, speed: 5, lanes: new Map(), home: false })
const turnRight = (route: NavRoute) => richInstruction(route, route.steps[1], { from: 560, speed: 5 })
const feet = (m: number) => `${Math.round(m * 3.28084 / 50) * 50} feet`

describe('walking the bike', () => {
  const sidewalk = { startDistance: 598, endDistance: 700, roadClass: 'footway', streetName: 'Trade Street', getOffBike: true }

  test('off a turn, says where and, when the prompt has no other distance, how far', () => {
    const route = ride([sidewalk])
    expect(voiceText(turnRight(route), t)).toBe('Turn right onto Trade Street, then walk your bike on the sidewalk')
    expect(voiceText(turnRight(route), t, { distance: feet })).toBe('Turn right onto Trade Street, then walk your bike on the sidewalk for 350 feet')
    expect(voiceText(turnRight(route), tEs, { distance: m => `${Math.round(m)} metros` }))
      .toBe('Gira a la derecha hacia Trade Street y luego bájate y lleva la bici por la acera durante 102 metros')
    const approach = { kind: 'maneuver' as const, phase: 'approach' as const, step: route.steps[1], distance: 200, then: null }
    expect(speechFor(approach, source(route, 400), true, false, t)).toBe('In 650 feet, turn right onto Trade Street, then walk your bike on the sidewalk')
  })

  test('through a plaza, across a bridge, up the stairs', () => {
    const through = (edge: Partial<RouteEdgeSegment>) => turnRight(ride([{ ...sidewalk, streetName: undefined, ...edge }])).dismount?.place
    expect(through({ roadClass: 'pedestrian' })).toBe('plaza')
    expect(through({ roadEnvironment: 'bridge' })).toBe('bridge')
    const stairs = ride([{ startDistance: 598, endDistance: 610, roadClass: 'steps', getOffBike: true, averageSlope: 20 }])
    const climb = dismountAt(stairs, 590, 630)!
    expect(climb).toMatchObject({ place: 'stairs', direction: 'up' })
    expect(dismountText(climb, t)).toBe('Carry your bike up the stairs')
  })

  test('a crosswalk walked across is not worth a word', () => {
    expect(turnRight(ride([{ startDistance: 598, endDistance: 606, roadClass: 'footway', crossing: 'marked', getOffBike: true }])).dismount).toBeUndefined()
  })

  test('partway along a road, the push is its own alert; at a turn, the turn says it', () => {
    const plaza = ride([{ startDistance: 598, endDistance: 750, roadClass: 'residential' }, { startDistance: 750, endDistance: 830, roadClass: 'pedestrian', getOffBike: true }], [push(750, 830)])
    const ahead = upcomingHazard(plaza, 700, 5)!
    expect(speechFor({ kind: 'hazard', ...ahead }, source(plaza, 700), true, false, t)).toBe('Walk your bike through the plaza for 260 feet')
    expect(speechFor({ kind: 'hazard', ...ahead }, source(plaza, 700), false, false, t)).toBe('Walk your bike ahead')
    expect(upcomingHazard(ride([sidewalk], [push(598, 700)]), 560, 5)).toBeNull()
  })
})
