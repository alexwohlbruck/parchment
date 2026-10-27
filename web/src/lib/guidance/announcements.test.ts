import { describe, expect, test } from 'vitest'
import { buildNavRoute, pointAt, smoothedBearingAt, stepIndexAt, type NavRoute } from './nav-route'
import { Announcer, destinationSide, leadDistances, type Announcement } from './announcements'
import { announcementText } from './phrases'
import type { PuckState } from './guidance-engine'
import { cityDrive, polyline } from './test-routes'
import { projectLatLng } from '@/lib/map/movement-interpolation'
import { speechDuration } from './speech-rate'
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


describe('initial navigation instruction', () => {
  test('gives the route heading immediately without a position update, once per route', () => {
    const input = cityDrive()
    input.instructions![0].streetName = 'Main Street'
    const route = buildNavRoute([input])
    const announcer = new Announcer(route, null)
    const initial = announcer.start()!
    expect(initial).toMatchObject({ kind: 'start', heading: 'north', road: 'Main Street' })
    expect(announcementText(initial, true, t)).toBe('Head north on Main Street')
    expect(announcer.start()).toBeNull()
    expect(announcer.update(puckAt(route, 0, 0))).toEqual([])
    announcer.setRoute(route)
    expect(announcer.start()).toMatchObject({ kind: 'start' })
  })

  test('gives a heading without inventing a street when instructions are absent', () => {
    const route = buildNavRoute([{ mode: 'walking', geometry: polyline([[90, 500]]) }])
    const initial = new Announcer(route, null).start()!
    expect(announcementText(initial, true, t)).toBe('Head east')
  })

  test('speaks an immediate opening turn instead of telling the traveller to go straight', () => {
    const input = cityDrive()
    input.instructions![0] = { ...input.instructions![0], type: 'turn', modifier: 'right', streetName: 'Main Street' }
    const initial = new Announcer(buildNavRoute([input]), null).start()!
    expect(announcementText(initial, true, t)).toBe('Turn right onto Main Street')
  })

  test('does not repeat a long-straight continuation immediately after the opening instruction', () => {
    const geometry = polyline([[0, 6000], [90, 500]])
    const route = buildNavRoute([{ mode: 'driving', geometry, instructions: [
      { type: 'depart', text: '', coordinate: geometry[0], distance: 6000, duration: 600, streetName: 'I 85' },
      { type: 'turn', modifier: 'right', text: '', coordinate: geometry[600], distance: 500, duration: 50 },
    ] }])
    const announcer = new Announcer(route, null)
    expect(announcementText(announcer.start()!, true, t)).toBe('Head north on I 85')
    expect(announcer.update(puckAt(route, 0, 0))).toEqual([])
    expect(announcer.update(puckAt(route, 5000, 20)).some(a => a.kind === 'maneuver')).toBe(true)
  })

  test('does not speak an opening direction for an empty route', () => {
    expect(new Announcer(buildNavRoute([]), null).start()).toBeNull()
  })
})


describe('speech timing', () => {
  test('combines turns at a slow chosen rate and spends their separate prompts', () => {
    const route = buildNavRoute([cityDrive()])
    route.steps[2].startDistance = 750
    const slow = new Announcer(route, null, () => 8 / 0.75)
    const fast = new Announcer(route, null, () => 8 / 1.5)
    expect(new Announcer(route, null, () => 8 / 0.75).update(puckAt(route, 580, 1.4)).find(a => a.kind === 'maneuver')).toMatchObject({ then: null })
    const walkingRoute = buildNavRoute([{ ...cityDrive(), mode: 'walking' }])
    walkingRoute.steps[2].startDistance = 750
    const walking = new Announcer(walkingRoute, null, () => 8 / 0.75)
    expect(walking.update(puckAt(walkingRoute, 590, 1.4)).find(a => a.kind === 'maneuver')).toMatchObject({ then: null })
    const combined = slow.update(puckAt(route, 440, 20)).find(a => a.kind === 'maneuver')
    expect(combined).toMatchObject({ phase: 'now', then: { index: 2 } })
    expect(fast.update(puckAt(route, 440, 20)).find(a => a.kind === 'maneuver')).toMatchObject({ then: null })
    for (let s = 442; s < 750; s += 2) {
      expect(slow.update(puckAt(route, s, 20)).filter(a => a.kind === 'maneuver' && a.step.index === 2)).toEqual([])
    }
    slow.setRoute(route)
    expect(slow.update(puckAt(route, 650, 20)).some(a => a.kind === 'maneuver' && a.step.index === 2)).toBe(true)
  })

  test('combines the opening direction with an imminent turn in one localized phrase', () => {
    const route = buildNavRoute([cityDrive()])
    route.steps[1].startDistance = 120
    const announcer = new Announcer(route, null, a => speechDuration(announcementText(a, true, t), 1))
    const opening = announcer.start()!
    expect(opening).toMatchObject({ kind: 'start', then: { index: 1 } })
    expect(announcementText(opening, true, t)).toMatch(/Head north, then in .*turn right/)
    expect(announcer.update(puckAt(route, 30, 13.9)).filter(a => a.kind === 'maneuver')).toEqual([])
  })

  test('keeps distant turns and different route segments separate', () => {
    const route = buildNavRoute([cityDrive()])
    expect((new Announcer(route, null).start() as { then?: unknown }).then).toBeUndefined()
    route.steps[2].startDistance = 650
    route.steps[2].segmentIndex = 1
    expect(new Announcer(route, null).update(puckAt(route, 440, 20)).find(a => a.kind === 'maneuver')).toMatchObject({ then: null })
  })
})
