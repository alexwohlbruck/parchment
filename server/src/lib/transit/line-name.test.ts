import { describe, test, expect } from 'bun:test'
import type { TransitDetails } from '../../types/trip.types'
import { nameLegByRoute } from './line-name'

const leg = (shortName: string | undefined, longName?: string): TransitDetails => {
  const stop = { id: 's', name: 'S', location: { lat: 0, lng: 0 } }
  return {
    route: { id: '38_9', shortName, longName, type: 'rail', agency: { id: 'LI', name: 'LIRR' } },
    trip: { id: 't', headsign: 'Port Washington' },
    stops: [stop, stop],
    departureStop: stop,
    arrivalStop: stop,
    shortName,
  }
}

describe('nameLegByRoute', () => {
  test('a route without a short name reads by its long name, keeping the train number', () => {
    const td = leg('1368', 'Port Washington Branch')
    nameLegByRoute(td, { routeShortName: null, routeLongName: 'Port Washington Branch' })

    expect(td.shortName).toBe('Port Washington Branch')
    expect(td.route.shortName).toBeUndefined()
    expect(td.trip.shortName).toBe('1368')
  })

  test('a route with its own short name is left alone', () => {
    const td = leg('3', '7 Avenue Express')
    nameLegByRoute(td, { routeShortName: '3', routeLongName: '7 Avenue Express' })

    expect(td.shortName).toBe('3')
    expect(td.route.shortName).toBe('3')
    expect(td.trip.shortName).toBeUndefined()
  })

  test('the GTFS long name stands in when the leg carries none', () => {
    const td = leg('790')
    nameLegByRoute(td, { routeShortName: null, routeLongName: 'Harlem' })

    expect(td.shortName).toBe('Harlem')
    expect(td.route.longName).toBe('Harlem')
    expect(td.trip.shortName).toBe('790')
  })

  test('a fallback that already is the line name is not a train number', () => {
    const td = leg('Harlem', 'Harlem')
    nameLegByRoute(td, { routeShortName: null, routeLongName: 'Harlem' })

    expect(td.shortName).toBe('Harlem')
    expect(td.trip.shortName).toBeUndefined()
  })

  test('a route with no name at all keeps what MOTIS gave', () => {
    const td = leg('354')
    nameLegByRoute(td, { routeShortName: null, routeLongName: null })

    expect(td.shortName).toBe('354')
    expect(td.trip.shortName).toBeUndefined()
  })
})
