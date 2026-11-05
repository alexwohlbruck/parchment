import { describe, expect, test } from 'bun:test'
import { cheapestWalk, rankByCrowFlies, usableFor } from './entrance-choice'

const platform = { lat: 40.75, lng: -73.99 }
// ~100 m north and ~100 m south of the platform
const north = { lat: 40.7509, lon: -73.99 }
const south = { lat: 40.7491, lon: -73.99 }

describe('usableFor', () => {
  test('an exit-only entrance is never entered by', () => {
    expect(usableFor({ ...north, entryAllowed: false, exitAllowed: true }, 'enter')).toBe(false)
    expect(usableFor({ ...north, entryAllowed: false, exitAllowed: true }, 'exit')).toBe(true)
  })

  test('an entry-only entrance is never left by', () => {
    expect(usableFor({ ...north, entryAllowed: true, exitAllowed: false }, 'exit')).toBe(false)
  })

  test('unknown flags allow both', () => {
    expect(usableFor(north, 'enter')).toBe(true)
    expect(usableFor({ ...north, entryAllowed: null, exitAllowed: null }, 'exit')).toBe(true)
  })
})

describe('rankByCrowFlies', () => {
  test('prefers the entrance on the rider\'s side of the station', () => {
    const fromNorth = { lat: 40.753, lng: -73.99 }
    expect(rankByCrowFlies([south, north], fromNorth, platform)[0]).toBe(north)
  })
})

describe('cheapestWalk', () => {
  test('takes the shortest whole walk, street plus station', () => {
    expect(cheapestWalk([north, south], [400, 250], platform)).toBe(south)
  })

  test('skips candidates that could not be routed', () => {
    expect(cheapestWalk([north, south], [null, 900], platform)).toBe(south)
  })

  test('falls back to the first guess when nothing routes', () => {
    expect(cheapestWalk([north, south], [null, null], platform)).toBe(north)
    expect(cheapestWalk([], [], platform)).toBeNull()
  })
})
