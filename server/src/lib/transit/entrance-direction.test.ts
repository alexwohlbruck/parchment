import { describe, test, expect } from 'bun:test'
import { bearingDeg, entranceFacesAway, entranceSign } from './entrance-direction'

const LEX_86 = { lat: 40.779492, lng: -73.955589 }
const LEX_77 = { lat: 40.77362, lng: -73.959874 }
const LEX_96 = { lat: 40.785672, lng: -73.95107 }

describe('entranceSign', () => {
  test('reads a compass word from the description', () => {
    expect(entranceSign(['6'], 'E 86th St & Lexington Av', '6,<6> trains Uptown & The Bronx')).toEqual({ heading: 0 })
    expect(entranceSign(['6'], null, '6,<6> trains Downtown')).toEqual({ heading: 180 })
    expect(entranceSign([], 'Westbound platform')).toEqual({ heading: 270 })
    expect(entranceSign([], 'North-bound only')).toEqual({ heading: 0 })
  })

  test('reads a destination the sign names', () => {
    expect(entranceSign(['R'], null, 'R trains to Manhattan')).toEqual({ toward: 'Manhattan' })
    expect(entranceSign(['R'], null, 'R trains to Bay Ridge–95th Street')).toEqual({ toward: 'Bay Ridge–95th Street' })
    expect(entranceSign(['3'], null, '2,3 trains to Flatbush & New Lots')).toEqual({ toward: 'Flatbush & New Lots' })
    expect(entranceSign(['Q'], 'Manhattan-bound trains')).toEqual({ toward: 'Manhattan' })
  })

  test('a line the entrance serves in both directions is not restricted by another line', () => {
    const sign = 'all F,G trains; R trains to Manhattan'
    expect(entranceSign(['F'], null, sign)).toBeNull()
    expect(entranceSign(['R'], null, sign)).toEqual({ toward: 'Manhattan' })
  })

  test('the clause naming the route wins over the entrance name', () => {
    expect(entranceSign(['R'], '4th Ave - 9th Street (R) to Queens', 'R trains to Manhattan'))
      .toEqual({ toward: 'Manhattan' })
  })

  test('any of a merged leg\'s routes selects its clause', () => {
    expect(entranceSign(['4', '5'], null, '5 trains Downtown; 6 trains Uptown')).toEqual({ heading: 180 })
  })

  test('an entrance naming no direction, or both, serves either', () => {
    expect(entranceSign(['Q'], '86th Street & 2nd Avenue', 'all Q trains')).toBeNull()
    expect(entranceSign(['R'], null, 'all D,N,R trains')).toBeNull()
    expect(entranceSign([], 'Uptown & Downtown')).toBeNull()
    expect(entranceSign(['R'], null, null)).toBeNull()
  })

  test('does not read a direction out of a street or place name', () => {
    expect(entranceSign([], 'Northern Blvd & 40 Rd')).toBeNull()
    expect(entranceSign([], 'Entrance to Macy\'s')).toBeNull()
    expect(entranceSign([], 'Inbound platform')).toBeNull()
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
