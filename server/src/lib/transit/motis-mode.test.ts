import { describe, test, expect } from 'bun:test'
import { routeTypeForMotisMode } from './motis-mode'

describe('routeTypeForMotisMode', () => {
  test('commuter and intercity rail read as rail, not bus', () => {
    for (const mode of ['REGIONAL_RAIL', 'SUBURBAN', 'LONG_DISTANCE', 'HIGHSPEED_RAIL']) {
      expect(routeTypeForMotisMode(mode)).toBe('rail')
    }
  })

  test('aerial lifts land on a type the client draws', () => {
    expect(routeTypeForMotisMode('AERIAL_LIFT')).toBe('aerial_lift')
    expect(routeTypeForMotisMode('GONDOLA')).toBe('aerial_lift')
    expect(routeTypeForMotisMode('CABLE_CAR')).toBe('cable_tram')
  })

  test('an unknown mode falls back to bus', () => {
    expect(routeTypeForMotisMode('ODM')).toBe('bus')
  })
})
