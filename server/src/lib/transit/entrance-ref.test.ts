import { describe, expect, test } from 'bun:test'
import { chosenEntrance, entranceRef, entranceWaypointLabel } from './entrance-ref'
import type { StationEntrance } from '../../types/integration.types'

const entrance = (over: Partial<StationEntrance>): StationEntrance => ({
  osmId: 'node/1', name: null, description: null, wheelchair: null, level: null,
  accessType: 'subway_entrance', lat: 40.75, lon: -73.99, distanceM: 20, ...over,
})

describe('entranceWaypointLabel', () => {
  test('OSM name, then ref, then the corner label', () => {
    const corner = 'Broadway & West 28th Street · NW corner'
    expect(entranceWaypointLabel(entrance({ name: 'Main St', ref: 'S2', cornerLabel: corner }))).toBe('Main St')
    expect(entranceWaypointLabel(entrance({ ref: 'S2', cornerLabel: corner }))).toBe('S2')
    expect(entranceWaypointLabel(entrance({ cornerLabel: corner, description: '1 trains Uptown' }))).toBe(corner)
    expect(entranceWaypointLabel(entrance({}))).toBeUndefined()
  })
})

describe('entranceRef', () => {
  test('carries the corner label and only restrictive flags', () => {
    expect(entranceRef(entrance({ cornerLabel: 'A & B · SE corner', entryAllowed: false, exitAllowed: true }), 'exit'))
      .toEqual({
        role: 'exit', name: undefined, ref: undefined, description: undefined,
        cornerLabel: 'A & B · SE corner', entryAllowed: false, accessType: 'subway_entrance',
      })
  })

  test('is null when nothing names the entrance', () => {
    expect(entranceRef(entrance({}), 'enter')).toBeNull()
  })
})

describe('chosenEntrance', () => {
  test('labels a chosen entrance by its corner', () => {
    const chosen = chosenEntrance({
      id: 'node/9', name: null, ref: null, cornerLabel: 'East 15th Street & Union Square East · SW corner',
      lat: 40.735, lng: -73.989, streetSeconds: 60, stationSeconds: 90, totalSeconds: 150,
      walk: {
        source: 'graph', estimate: false, seconds: 90, uncertaintyS: 10, metres: 80, levels: 1,
        from: { id: 'node/9', kind: 'entrance', name: null, lat: 40.735, lng: -73.989, level: 0 },
        to: { id: 'p1', kind: 'platform', name: null, lat: 40.7352, lng: -73.9892, level: -1 },
      },
    }, 'subway_entrance')
    expect([chosen.lat, chosen.lon]).toEqual([40.735, -73.989])
    expect(entranceRef(chosen, 'enter')).toMatchObject({
      role: 'enter', cornerLabel: 'East 15th Street & Union Square East · SW corner', accessType: 'subway_entrance',
    })
  })
})
