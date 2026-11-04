import { describe, expect, test } from 'bun:test'
import { entranceRef, entranceWaypointLabel } from './entrance-ref'
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
