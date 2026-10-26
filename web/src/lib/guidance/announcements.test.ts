import { describe, expect, test } from 'vitest'
import { buildNavRoute, pointAt, smoothedBearingAt, stepIndexAt, type NavRoute } from './nav-route'
import { Announcer, destinationSide, leadDistances, type Announcement } from './announcements'
import { announcementText } from './phrases'
import type { PuckState } from './guidance-engine'
import { cityDrive, polyline } from './test-routes'
import { projectLatLng } from '@/lib/map/movement-interpolation'
import en from '@/lib/i18n/en-US.json'

function puckAt(route: NavRoute, s: number, speed: number): PuckState {
  return { position: pointAt(route, s), bearing: smoothedBearingAt(route, s, 5), s, speed, snapped: true, stepIndex: stepIndexAt(route, s) }
}

/** Drive the whole route at a steady speed, collecting every prompt. */
function drive(route: NavRoute, speed: number, step = 2) {
  const announcer = new Announcer(route, null)
  const heard: { s: number; a: Announcement }[] = []
  for (let s = 0; s <= route.length; s += step) {
    for (const a of announcer.update(puckAt(route, s, speed))) heard.push({ s, a })
  }
  return heard
}

const t = (key: string, named: Record<string, unknown> = {}) => {
  const value = key.split('.').reduce<any>((node, part) => node?.[part], en)
  return String(value).replace(/\{(\w+)\}/g, (_, k) => String(named[k] ?? ''))
}

describe('leadDistances', () => {
  test('grow with speed and never drop below the mode floor', () => {
    expect(leadDistances('driving', 30).approach).toBeGreaterThan(leadDistances('driving', 10).approach)
    expect(leadDistances('driving', 0).approach).toEqual(leadDistances('driving', 13.9).approach)
    expect(leadDistances('walking', 1.4).prepare).toBeNull()
  })
})

describe('Announcer', () => {
  const route = buildNavRoute([cityDrive()])

  test('announces each turn once, approach before now, then arrival', () => {
    const heard = drive(route, 12)
    const turns = heard.filter(h => h.a.kind === 'maneuver')
    for (const index of [1, 2]) {
      const phases = turns.filter(h => h.a.kind === 'maneuver' && h.a.step.index === index).map(h => (h.a as any).phase)
      expect(phases.slice(-2)).toEqual(['approach', 'now'])
      expect(new Set(phases).size).toBe(phases.length)
    }
    expect(heard.filter(h => h.a.kind === 'arrived')).toHaveLength(1)
  })

  test('speaks the turn-now prompt shortly before the turn', () => {
    const now = drive(route, 12).find(h => h.a.kind === 'maneuver' && h.a.phase === 'now' && h.a.step.index === 1)!
    expect(600 - now.s).toBeGreaterThan(10)
    expect(600 - now.s).toBeLessThan(110)
  })

  test('a long straight gets a continue prompt', () => {
    const highway = buildNavRoute([{
      mode: 'driving',
      geometry: polyline([[0, 6000], [90, 500]]),
      instructions: [
        { type: 'depart', text: '', coordinate: polyline([[0, 1]])[0], distance: 0, duration: 0, streetName: 'I 85' },
        { type: 'turn', modifier: 'right', text: '', coordinate: polyline([[0, 6000]]).at(-1)!, distance: 0, duration: 0 },
      ],
    }])
    const heard = drive(highway, 30, 5)
    expect(heard[0].a).toMatchObject({ kind: 'maneuver', phase: 'continue' })
    expect(heard.some(h => h.a.kind === 'maneuver' && h.a.phase === 'prepare')).toBe(true)
  })
})

describe('destinationSide', () => {
  const route = buildNavRoute([{ mode: 'driving', geometry: polyline([[0, 300]]) }])
  test('tells left from right of the final heading', () => {
    const end = pointAt(route, route.length)
    expect(destinationSide(route, projectLatLng(end, 15, 90, 1))).toBe('right')
    expect(destinationSide(route, projectLatLng(end, 15, 270, 1))).toBe('left')
    expect(destinationSide(route, projectLatLng(end, 15, 0, 1))).toBeNull()
  })
})

describe('announcementText', () => {
  const route = buildNavRoute([cityDrive()])
  const right = route.steps[1]
  const left = route.steps[2]

  test('says the distance and the action mid-sentence', () => {
    const text = announcementText({ kind: 'maneuver', phase: 'approach', step: { ...right, instruction: { ...right.instruction, streetName: 'Market St' } }, distance: 160, then: null }, false, t)
    expect(text).toBe('In 500 feet, turn right onto Market St')
  })

  test('chains a close follow-up turn', () => {
    expect(announcementText({ kind: 'maneuver', phase: 'now', step: right, distance: 20, then: left }, false, t)).toBe('Turn right, then turn left')
  })

  test('uses singular units and the destination side', () => {
    expect(announcementText({ kind: 'arrive', distance: 1609, side: 'left' }, false, t)).toBe('In 1.0 mile, your destination is on the left')
  })
})
