import { describe, expect, test } from 'vitest'
import { Announcer, type Announcement, type AnnouncementPhase } from '../announcements'
import type { LanePlan } from '../lanes'
import { buildNavRoute, pointAt, smoothedBearingAt, stepIndexAt, type NavRoute } from '../nav-route'
import { cityDrive, gridWalk, polyline, translator } from '../test-routes'
import { speechFor, type RichSource } from './rich-announcement'
import en from '@/lib/i18n/en-US.json'
import es from '@/lib/i18n/es-ES.json'

const t = translator(en)
const tEs = translator(es)

function withLight(): NavRoute {
  const drive = cityDrive()
  drive.instructions![1].streetName = 'Trade Street'
  drive.hazards = [{ kind: 'traffic_signals', severity: 'low', startDistance: 596, coordinate: drive.geometry![59] }]
  return buildNavRoute([drive])
}

const source = (route: NavRoute, over: Partial<RichSource> = {}): RichSource => ({
  route,
  from: 400,
  speed: 12,
  lanes: new Map(),
  home: false,
  ...over,
})

const approach = (route: NavRoute): Announcement => ({ kind: 'maneuver', phase: 'approach', step: route.steps[1], distance: 200, then: null })

describe('speechFor', () => {
  const route = withLight()

  test('premium travellers hear the landmark in place of the distance', () => {
    expect(speechFor(approach(route), source(route), true, false, t)).toBe('At the light, turn right onto Trade Street')
    expect(speechFor(approach(route), source(route), true, true, tEs)).toBe('En el semáforo, gira a la derecha hacia Trade Street')
  })

  test('the distance stands in where no landmark places the turn', () => {
    expect(speechFor(approach(route), source(route, { from: 590 }), true, false, t)).toBe('In 650 feet, turn right onto Trade Street')
  })

  test('everyone else hears the standard phrasing, lanes included', () => {
    const lanes = new Map<number, LanePlan>([[1, { lanes: [{ arrows: ['through'], valid: false, recommended: false }, { arrows: ['right'], valid: true, recommended: true }] }]])
    expect(speechFor(approach(route), source(route), false, false, t)).toBe('In 650 feet, turn right onto Trade Street')
    expect(speechFor(approach(route), source(route, { lanes }), false, false, t)).toBe('In 650 feet, turn right onto Trade Street. Use the right lane')
  })

  test('falls back where rich guidance has nothing more to say', () => {
    const hazard: Announcement = { kind: 'hazard', hazard: { ...route.hazards[0], kind: 'rail_crossing' }, distance: 100 }
    expect(speechFor(hazard, source(route), true, false, t)).toBe('Railroad crossing ahead')
    const arrived: Announcement = { kind: 'arrived', side: 'right' }
    expect(speechFor(arrived, source(route), true, false, t)).toBe('You have arrived. Your destination is on the right')
    expect(speechFor(arrived, source(route, { home: true }), true, false, t)).toBe('Welcome home. Your destination is on the right')
  })

  test('turning around to set off', () => {
    const turn: Announcement = { kind: 'turn-around', heading: 'west', road: 'Trade Street' }
    expect(speechFor(turn, source(route), true, false, t)).toBe('Turn around to begin your route, then head west along Trade Street')
  })
})

describe('blocks on foot', () => {
  const route = gridWalk([[200, 'Lincoln Place'], [400, 'Saint Johns Place'], [600, 'Sterling Place'], [800, 'Park Place']])
  const prompt = (phase: AnnouncementPhase, from: number): Announcement =>
    ({ kind: 'maneuver', phase, step: route.steps[1], distance: 1000 - from, then: null })

  test('the turn ahead, in blocks', () => {
    expect(speechFor(prompt('approach', 20), source(route, { from: 20, speed: 1.4 }), true, false, t)).toBe('In 5 blocks, turn right onto Bedford Avenue')
    expect(speechFor(prompt('approach', 20), source(route, { from: 20, speed: 1.4 }), true, true, tEs)).toBe('En 5 manzanas, gira a la derecha hacia Bedford Avenue')
  })

  test('how long to keep on the street', () => {
    expect(speechFor(prompt('continue', 20), source(route, { from: 20, speed: 1.4 }), true, false, t)).toBe('Continue on Rogers Avenue for 5 blocks')
  })

  test('the distance where the blocks are too irregular to count', () => {
    const irregular = gridWalk([[200, 'Lincoln Place'], [700, 'Park Place']])
    const continuing: Announcement = { kind: 'maneuver', phase: 'continue', step: irregular.steps[1], distance: 980, then: null }
    expect(speechFor(continuing, source(irregular, { from: 20, speed: 1.4 }), true, false, t)).toBe('Continue on Rogers Avenue for 0.6 miles')
  })
})

describe('crossing to the destination', () => {
  function across(length: number): NavRoute {
    const line = polyline([[0, 100 + length]])
    return buildNavRoute([{
      mode: 'walking',
      geometry: line,
      instructions: [
        { type: 'depart', text: '', coordinate: line[0], distance: 100, duration: 70 },
        { type: 'continue', modifier: 'straight', text: '', coordinate: line[10], distance: length, duration: 70 },
        { type: 'destination', text: '', coordinate: line.at(-1)!, distance: 0, duration: 0 },
      ],
      edgeSegments: [{ startDistance: 100, endDistance: 115, roadClass: 'footway', crossing: 'marked', crossingName: 'Franklin Avenue' }],
    }])
  }
  const crossing = (route: NavRoute): Announcement => ({ kind: 'maneuver', phase: 'approach', step: route.steps[1], distance: 40, then: null })

  test('the last crossing says which side the destination is on', () => {
    const route = across(60)
    expect(speechFor(crossing(route), source(route, { from: 60, speed: 1.4, destinationSide: 'right' }), true, false, t))
      .toBe('Cross Franklin Avenue at the crosswalk; your destination is on the right')
  })

  test('not while the destination is still some way off', () => {
    const route = across(600)
    expect(speechFor(crossing(route), source(route, { from: 60, speed: 1.4, destinationSide: 'right' }), true, false, t)).toBe('Cross Franklin Avenue at the crosswalk')
  })
})

describe('border welcomes', () => {
  function crossing(): NavRoute {
    const drive = cityDrive()
    drive.edgeSegments = [
      { startDistance: 0, endDistance: 800, country: 'USA' },
      { startDistance: 800, endDistance: 1500, country: 'CAN' },
    ]
    return buildNavRoute([drive])
  }

  function heard(announcer: Announcer, route: NavRoute) {
    const all: Announcement[] = []
    for (let s = 0; s <= route.length; s += 5) {
      all.push(...announcer.update({ position: pointAt(route, s), bearing: smoothedBearingAt(route, s, 5), s, speed: 12, snapped: true, stepIndex: stepIndexAt(route, s), estimated: false }))
    }
    return all.filter(a => a.kind === 'border')
  }

  test('welcome the traveller once on entering another country', () => {
    const route = crossing()
    const announcer = new Announcer(route, null, () => 2, { regionName: code => (code === 'CAN' ? 'Canada' : null) })
    const welcomes = heard(announcer, route)
    expect(welcomes).toEqual([{ kind: 'border', region: 'Canada' }])
    expect(speechFor(welcomes[0], source(route), true, false, t)).toBe('Welcome to Canada')
  })

  test('welcome the traveller to another state', () => {
    const drive = cityDrive()
    drive.edgeSegments = [
      { startDistance: 0, endDistance: 800, country: 'USA', state: 'New York' },
      { startDistance: 800, endDistance: 1500, country: 'USA', state: 'New Jersey' },
    ]
    const route = buildNavRoute([drive])
    const welcomes = heard(new Announcer(route, null, () => 2, { regionName: () => 'United States' }), route)
    expect(welcomes).toEqual([{ kind: 'border', region: 'New Jersey' }])
    expect(speechFor(welcomes[0], source(route), true, false, tEs)).toBe('Bienvenido a New Jersey')
  })

  test('a country entered is welcomed once, not again for its province', () => {
    const drive = cityDrive()
    drive.edgeSegments = [
      { startDistance: 0, endDistance: 800, country: 'USA', state: 'New York' },
      { startDistance: 800, endDistance: 820, country: 'CAN', state: 'New York' },
      { startDistance: 820, endDistance: 1500, country: 'CAN', state: 'Ontario' },
    ]
    const route = buildNavRoute([drive])
    const announcer = new Announcer(route, null, () => 2, { regionName: code => (code === 'CAN' ? 'Canada' : null) })
    expect(heard(announcer, route)).toEqual([{ kind: 'border', region: 'Canada' }])
  })

  test('stay quiet without a way to name the country', () => {
    const route = crossing()
    expect(heard(new Announcer(route, null), route)).toEqual([])
  })
})
