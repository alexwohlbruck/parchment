import { describe, test, expect } from 'bun:test'
import { bearingDeg, entranceFacesAway, entranceHeading } from './entrance-direction'

const LEX_86 = { lat: 40.779492, lng: -73.955589 }
const LEX_77 = { lat: 40.77362, lng: -73.959874 }
const LEX_96 = { lat: 40.785672, lng: -73.95107 }

describe('entranceHeading', () => {
  test('reads a one-direction entrance from its description', () => {
    expect(entranceHeading('E 86th St & Lexington Av', '6,<6> trains Uptown & The Bronx')).toBe(0)
    expect(entranceHeading(null, '6,<6> trains Downtown')).toBe(180)
    expect(entranceHeading('Westbound platform')).toBe(270)
    expect(entranceHeading('North-bound only')).toBe(0)
  })

  test('an entrance naming no direction, or both, serves either', () => {
    expect(entranceHeading('86th Street & 2nd Avenue', 'all Q trains')).toBeNull()
    expect(entranceHeading('Uptown & Downtown')).toBeNull()
    expect(entranceHeading(null, null)).toBeNull()
  })

  test('does not read a direction out of a street name', () => {
    expect(entranceHeading('Northern Blvd & 40 Rd')).toBeNull()
  })
})

describe('entranceFacesAway', () => {
  const downtown = bearingDeg(LEX_86, LEX_77)
  const uptown = bearingDeg(LEX_86, LEX_96)

  test('a downtown ride skips the uptown-only entrance (86 St, Lexington)', () => {
    expect(entranceFacesAway(0, downtown)).toBe(true)
    expect(entranceFacesAway(180, downtown)).toBe(false)
  })

  test('uptown on the tilted Manhattan grid still matches north', () => {
    expect(uptown).toBeGreaterThan(20)
    expect(uptown).toBeLessThan(40)
    expect(entranceFacesAway(0, uptown)).toBe(false)
  })

  test('without a heading or a bearing nothing is excluded', () => {
    expect(entranceFacesAway(null, downtown)).toBe(false)
    expect(entranceFacesAway(0, null)).toBe(false)
  })
})
