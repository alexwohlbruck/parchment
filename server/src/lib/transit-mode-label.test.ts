import { describe, test, expect } from 'bun:test'
import { transitLineSubtitle, transitModeLabel, transitStopLabel } from './transit-mode-label'

describe('transitLineSubtitle', () => {
  test('names the mode like a rider would', () => {
    expect(transitLineSubtitle(1, 'subway', 'MTA New York City Transit'))
      .toBe('MTA New York City Transit · Subway line')
    expect(transitLineSubtitle(4, 'ferry', 'NYC Ferry'))
      .toBe('NYC Ferry · Ferry line')
  })

  test('a feed with no agency still gets a readable subtitle', () => {
    // LIRR's feed names no agency; the old subtitle was the bare word "rail".
    expect(transitLineSubtitle(2, 'rail', null)).toBe('Commuter rail line')
  })

  test('intercity carriers are not commuter rail', () => {
    expect(transitLineSubtitle(2, 'rail', 'Amtrak')).toBe('Amtrak · Intercity rail line')
    expect(transitLineSubtitle(2, 'rail', 'Via Rail Canada')).toBe('Via Rail Canada · Intercity rail line')
    expect(transitLineSubtitle(2, 'rail', 'Metro-North Railroad')).toBe('Metro-North Railroad · Commuter rail line')
  })

  test('extended codes refine the label', () => {
    expect(transitModeLabel(711, 'bus', 'MTA New York City Transit')).toBe('Shuttle bus route')
    expect(transitModeLabel(702, 'bus', null)).toBe('Express bus route')
    expect(transitModeLabel(109, 'rail', null)).toBe('Commuter rail line')
  })

  test('buses run routes, rail runs lines', () => {
    expect(transitModeLabel(3, 'bus', null)).toBe('Bus route')
    expect(transitModeLabel(0, 'tram', null)).toBe('Light rail line')
  })

  test('falls back to the coarse mode when the code is unknown', () => {
    expect(transitModeLabel(null, 'subway', null)).toBe('Subway line')
    expect(transitModeLabel(9999, 'ferry', null)).toBe('Ferry line')
    expect(transitModeLabel(null, null, null)).toBe('Transit line')
  })
})

describe('transitStopLabel', () => {
  test('stations, stops and terminals by mode', () => {
    expect(transitStopLabel('subway')).toBe('Subway station')
    expect(transitStopLabel('rail')).toBe('Train station')
    expect(transitStopLabel('bus')).toBe('Bus stop')
    expect(transitStopLabel('ferry')).toBe('Ferry terminal')
    expect(transitStopLabel(null)).toBe('Transit stop')
  })
})
