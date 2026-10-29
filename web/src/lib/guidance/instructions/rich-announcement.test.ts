import { describe, expect, test } from 'vitest'
import { Announcer, type Announcement } from '../announcements'
import type { LanePlan } from '../lanes'
import { buildNavRoute, pointAt, smoothedBearingAt, stepIndexAt, type NavRoute } from '../nav-route'
import { cityDrive, translator } from '../test-routes'
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

  test('premium travellers hear the landmark', () => {
    expect(speechFor(approach(route), source(route), true, false, t)).toBe('In 650 feet, at the light, turn right onto Trade Street')
    expect(speechFor(approach(route), source(route), true, true, tEs)).toBe('En 200 metros, en el semáforo, gira a la derecha hacia Trade Street')
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
      all.push(...announcer.update({ position: pointAt(route, s), bearing: smoothedBearingAt(route, s, 5), s, speed: 12, snapped: true, stepIndex: stepIndexAt(route, s) }))
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

  test('stay quiet without a way to name the country', () => {
    const route = crossing()
    expect(heard(new Announcer(route, null), route)).toEqual([])
  })
})
