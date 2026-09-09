/**
 * Transit stop detection.
 *
 * Whether a place gets the station treatment (departure board, lines served,
 * realtime indicators) comes down to these two predicates, and the failure is
 * silent in both directions: miss a station and it renders as a plain POI
 * (PAR-288, the Roosevelt Island Tramway), match a line or a ski lift and the
 * place sprouts a departure board that can never fill.
 */

import { describe, test, expect } from 'bun:test'
import {
  isTransitStopFromTags,
  isTransitStopType,
  isTransitStop,
  getGTFSRouteTypesFromTags,
} from './transit-utils'

describe('isTransitStopFromTags', () => {
  test.each([
    ['subway station', { railway: 'station', station: 'subway', public_transport: 'station' }],
    ['train halt', { railway: 'halt' }],
    ['tram stop', { railway: 'tram_stop' }],
    ['bus stop', { highway: 'bus_stop' }],
    ['bus station', { amenity: 'bus_station' }],
    ['ferry terminal', { amenity: 'ferry_terminal' }],
    ['stopping location', { public_transport: 'stop_position' }],
    ['aerialway station', { aerialway: 'station', building: 'roof' }],
    ['aerialway stop node', { aerialway: 'yes', public_transport: 'stop_position' }],
    ['funicular station', { railway: 'station', station: 'funicular' }],
  ])('matches a %s', (_label, tags) => {
    expect(isTransitStopFromTags(tags)).toBe(true)
  })

  test.each([
    ['aerial lift line', { aerialway: 'cable_car' }],
    ['gondola line', { aerialway: 'gondola' }],
    ['aerialway pylon', { aerialway: 'pylon' }],
    ['rail line', { railway: 'rail' }],
    ['subway entrance', { railway: 'subway_entrance' }],
    ['ordinary road', { highway: 'residential' }],
    ['cafe', { amenity: 'cafe' }],
    ['nothing', {}],
  ])('does not match a %s', (_label, tags) => {
    expect(isTransitStopFromTags(tags)).toBe(false)
  })
})

describe('isTransitStopType', () => {
  test.each([
    'Aerialway Station',
    'Aerialway Stopping Location',
    'Aerialway Platform',
    'Ferry Terminal',
    'Ferry Stop / Platform',
    'Bus Station / Terminal',
    'Bus Stop',
    'Subway Station',
    'Train Station (Halt / Request)',
    'Light Rail Platform',
    'Monorail Station',
    'Tram Station',
    'Trolleybus Station / Terminal',
    'Transit Stop / Platform',
    'transit_station',
    'Railway Feature',
  ])('matches %p', (label) => {
    expect(isTransitStopType(label)).toBe(true)
  })

  test.each([
    // The line, not a boarding point
    'Cable Car',
    'Gondola Lift',
    'Aerialway Pylon',
    'Light Rail Track',
    'Train Track',
    'Rail Yard',
    'Subway Entrance',
    // Ordinary places that happen to end in "Station"
    'Gas Station',
    'Fire Station',
    'Police Station',
    'Charging Station',
    'Cafe',
  ])('does not match %p', (label) => {
    expect(isTransitStopType(label)).toBe(false)
  })
})

describe('getGTFSRouteTypesFromTags', () => {
  test('maps an aerialway station to the aerial lift types, and to tram', () => {
    // Feeds publish aerial tramways as plain trams as often as as aerial lifts:
    // RIOC types the Roosevelt Island Tramway 0.
    const types = getGTFSRouteTypesFromTags({ aerialway: 'station' })

    expect(types).toContain(5) // cable car
    expect(types).toContain(6) // aerial lift
    expect(types).toContain(0) // tram
  })

  test('maps a ferry terminal to the ferry types, including the extended range', () => {
    expect(getGTFSRouteTypesFromTags({ amenity: 'ferry_terminal' })).toEqual([4, 1000, 1200])
  })

  test('maps a bus stop to the bus types', () => {
    expect(getGTFSRouteTypesFromTags({ highway: 'bus_stop' })).toContain(3)
  })

  test('covers every mode a multimodal station serves', () => {
    const types = getGTFSRouteTypesFromTags({
      railway: 'station',
      station: 'subway',
      public_transport: 'station',
    })

    expect(types).toContain(1) // subway
    expect(types).toContain(2) // rail
  })

  test('returns nothing when the tags name no mode', () => {
    // Falls back to plain nearest-stop matching rather than guessing.
    expect(getGTFSRouteTypesFromTags({ public_transport: 'platform' })).toEqual([])
  })
})

describe('isTransitStop', () => {
  test('accepts a place matched by type alone', () => {
    expect(isTransitStop('Subway Station', {})).toBe(true)
  })

  test('accepts a place matched by tags alone', () => {
    expect(isTransitStop('Building', { aerialway: 'station' })).toBe(true)
  })

  test('rejects a place matched by neither', () => {
    expect(isTransitStop('Cafe', { amenity: 'cafe' })).toBe(false)
  })
})
