import { describe, it, expect } from 'vitest'
import { getRouteBulletLabel, getRouteTypeKey } from './transit'
import en from './i18n/en-US.json'

/**
 * What goes on a route bullet.
 *
 * A bullet is sized for "6", "N", "M15" — a `route_short_name`. Plenty of feeds
 * publish none: the Roosevelt Island Tramway is one, and falling through to the
 * GTFS route id put a bare "10092" on the station header where a rider expects a
 * line. Nothing about that failure is loud; it just renders a number nobody
 * recognises, so these cases are worth pinning down.
 */

/** Stand-in for vue-i18n's `t`, resolving the real en-US strings. */
function t(key: string, choice = 0): string {
  const value = key.split('.').reduce<any>((node, part) => node?.[part], en)
  if (typeof value !== 'string') return key
  // vue-i18n pluralisation: for "tram | trams", choice 1 is the singular and
  // anything else the plural — not an index into the forms.
  const forms = value.split('|').map(s => s.trim())
  return forms.length > 1 ? (choice === 1 ? forms[0] : forms[1]) : value
}

describe('getRouteBulletLabel', () => {
  it('prefers the short name, which is what a bullet is for', () => {
    expect(getRouteBulletLabel({ shortName: '6', longName: 'Lexington Av Local', type: 1 }, t))
      .toBe('6')
  })

  it('names the mode when the feed publishes no short name', () => {
    // The Roosevelt Island Tramway, published by RIOC with a long name only.
    expect(
      getRouteBulletLabel(
        { shortName: '', longName: 'Roosevelt Island Aerial Tramway', type: 5 },
        t,
      ),
    ).toBe('Tram')
  })

  it('never falls back to a raw route id', () => {
    const label = getRouteBulletLabel({ longName: 'Roosevelt Island Aerial Tramway', type: 5 }, t)
    expect(label).not.toMatch(/^\d+$/)
  })

  it('uses a long name only when it is genuinely bullet-sized', () => {
    expect(getRouteBulletLabel({ longName: 'RW', type: 4 }, t)).toBe('RW')
    expect(getRouteBulletLabel({ longName: 'South Brooklyn', type: 4 }, t)).toBe('Ferry')
  })

  it('treats a whitespace-only short name as absent', () => {
    expect(getRouteBulletLabel({ shortName: '   ', longName: 'East River', type: 4 }, t))
      .toBe('Ferry')
  })

  it('falls back to a generic label for an unknown mode', () => {
    expect(getRouteBulletLabel({ type: 99 }, t)).toBe('Vehicle')
  })
})

describe('getRouteTypeKey', () => {
  it.each([
    [0, 'tram'],
    [1, 'subway'],
    [2, 'rail'],
    [3, 'bus'],
    [4, 'ferry'],
    [5, 'tram'], // cable car
    [6, 'tram'], // aerial lift
    [7, 'tram'], // funicular
  ])('maps basic route_type %i to %s', (type, key) => {
    expect(getRouteTypeKey(type)).toBe(key)
  })

  it.each([
    [401, 'subway'],
    [109, 'rail'],
    [711, 'bus'],
    [1200, 'ferry'],
  ])('maps extended route_type %i to %s', (type, key) => {
    // Real feeds use the extended ranges — NYC's shuttle buses are 711.
    expect(getRouteTypeKey(type)).toBe(key)
  })

  it('has a label for every key it can return', () => {
    const keys = [0, 1, 2, 3, 4, 5, 99].map(getRouteTypeKey)
    for (const key of keys) {
      expect(t(`place.transit.vehicleType.${key}`, 1)).not.toBe(
        `place.transit.vehicleType.${key}`,
      )
    }
  })
})
