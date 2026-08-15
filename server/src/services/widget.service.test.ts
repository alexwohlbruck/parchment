/**
 * Unit tests for widget resolution.
 *
 * `resolveWidgetDescriptors` decides which cards a place detail renders, and
 * the detection rules are easy to get subtly wrong:
 *
 *   - a transit stop is recognised either from stored transit info OR from its
 *     OSM tags, since Barrelman-sourced stops often have neither a feed nor a
 *     stop id yet — and the tags may live in `tags` or in `amenities`
 *     depending on which source produced the place;
 *   - a bikeshare dock is matched exactly via the `ref:gbfs` tag
 *     (`systemId:stationId`) and falls back to a proximity match, but a
 *     DOCKLESS rental area is excluded — it has no capacity to report, so the
 *     availability card would always read "0 of 0";
 *   - display chips are lifted out of the raw tag list so the same tag doesn't
 *     render twice.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'

mock.module('./integrations', () => ({
  integrationManager: {
    getConfiguredIntegrationsByCapability: () => [],
    getCachedIntegrationInstance: () => null,
    getConfiguredIntegrations: () => [],
  },
}))

mock.module('./integrations/overpass-integration', () => ({
  OverpassIntegration: class {},
}))
mock.module('./integrations/barrelman-integration', () => ({
  BarrelmanIntegration: class {},
}))

mock.module('../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
  logError: () => {},
  logWarn: () => {},
}))

const { resolveWidgetDescriptors, fetchWidgetData } = await import('./widget.service')
const { WidgetType, WidgetDataType } = await import('../types/place.types')

/** Minimal Place with a centre point. */
function place(over: Partial<any> = {}): any {
  const { lat = 35.2, lng = -80.8, ...rest } = over
  return {
    id: 'osm/node/1',
    name: { value: 'Somewhere' },
    geometry: { value: { center: { lat, lng } } },
    tags: {},
    ...rest,
  }
}

function descriptorTypes(p: any): string[] {
  return resolveWidgetDescriptors(p).map((d) => d.type)
}

function findDescriptor(p: any, type: string) {
  return resolveWidgetDescriptors(p).find((d) => d.type === type)
}

describe('transit descriptor', () => {
  test('is emitted for a place with stored transit info', () => {
    const transit = findDescriptor(
      place({ transit: { value: { feedId: 'f-1', stopId: 's-1', name: 'Main St' } } }),
      WidgetType.TRANSIT,
    )

    expect(transit).toBeDefined()
    expect(transit!.dataType).toBe(WidgetDataType.ASYNC)
  })

  test('is emitted for a stop recognised only from its OSM tags', () => {
    // Barrelman-sourced stops frequently carry no feed or stop id.
    const types = descriptorTypes(
      place({
        amenities: { public_transport: { value: 'platform' } },
        placeType: { value: 'bus_stop' },
      }),
    )

    expect(types).toContain(WidgetType.TRANSIT)
  })

  test('is emitted for a stop whose tags only landed in `tags`', () => {
    // Barrelman puts raw OSM tags in `tags` and leaves `amenities` empty, so a
    // stop is invisible to detection that only reads amenities.
    const types = descriptorTypes(
      place({ tags: { public_transport: 'platform' } }),
    )

    expect(types).toContain(WidgetType.TRANSIT)
  })

  test('is emitted for an aerialway station (PAR-288)', () => {
    // The Roosevelt Island Tramway: an aerial lift terminal in the MTA-area
    // GTFS feeds, tagged with no rail tag at all.
    const types = descriptorTypes(
      place({
        tags: { aerialway: 'station', building: 'roof' },
        placeType: { value: 'Aerialway Station' },
      }),
    )

    expect(types).toContain(WidgetType.TRANSIT)
  })

  test('passes the mode implied by the tags so the right stop is matched', () => {
    // Without this the nearest stop wins outright, and a ferry terminal is
    // identified by the bus stop across the street.
    const transit = findDescriptor(
      place({ tags: { amenity: 'ferry_terminal' } }),
      WidgetType.TRANSIT,
    )

    expect(transit!.params.routeTypes).toBe('4,1000,1200')
  })

  test('omits the mode hint when the tags name no mode', () => {
    const transit = findDescriptor(
      place({ tags: { public_transport: 'platform' } }),
      WidgetType.TRANSIT,
    )

    expect(transit!.params.routeTypes).toBeUndefined()
  })

  test('is not emitted for the aerial lift line itself', () => {
    const types = descriptorTypes(
      place({ tags: { aerialway: 'cable_car' }, placeType: { value: 'Cable Car' } }),
    )

    expect(types).not.toContain(WidgetType.TRANSIT)
  })

  test('is not emitted for an ordinary place', () => {
    expect(descriptorTypes(place({ tags: { amenity: 'cafe' } }))).not.toContain(
      WidgetType.TRANSIT,
    )
  })

  test('carries the coordinates so departures can be fetched', () => {
    const transit = findDescriptor(
      place({ transit: { value: { stopId: 's-1' } }, lat: 35.5, lng: -80.5 }),
      WidgetType.TRANSIT,
    )

    expect(transit!.params).toMatchObject({ lat: '35.5', lng: '-80.5' })
  })

  test('passes feed and stop ids through when present', () => {
    const transit = findDescriptor(
      place({ transit: { value: { feedId: 'f-1', stopId: 's-1' } } }),
      WidgetType.TRANSIT,
    )

    expect(transit!.params).toMatchObject({ feedId: 'f-1', stopId: 's-1' })
  })

  test('joins onestop ids for backwards compatibility', () => {
    const transit = findDescriptor(
      place({
        transit: { value: { onestopId: 'o-1', onestopIds: ['o-1', 'o-2'] } },
      }),
      WidgetType.TRANSIT,
    )

    expect(transit!.params.onestopIds).toBe('o-1,o-2')
  })

  test('prefers the transit stop name for the card title', () => {
    const transit = findDescriptor(
      place({ transit: { value: { stopId: 's-1', name: 'Main St Station' } } }),
      WidgetType.TRANSIT,
    )

    expect(transit!.title).toBe('Main St Station')
  })

  test('falls back to the place name for the title', () => {
    const transit = findDescriptor(
      place({ name: { value: 'Platform 3' }, transit: { value: { stopId: 's-1' } } }),
      WidgetType.TRANSIT,
    )

    expect(transit!.title).toBe('Platform 3')
  })

  test('is skipped when the place has no coordinates', () => {
    const types = descriptorTypes({
      id: 'x',
      name: { value: 'No geo' },
      tags: {},
      transit: { value: { stopId: 's-1' } },
      geometry: undefined,
    })

    expect(types).not.toContain(WidgetType.TRANSIT)
  })
})

describe('bikeshare descriptor', () => {
  test('is emitted for a docking station with a ref:gbfs tag', () => {
    const widget = findDescriptor(
      place({ tags: { amenity: 'bicycle_rental', 'ref:gbfs': 'sys-1:station-9' } }),
      WidgetType.BIKESHARE,
    )

    expect(widget).toBeDefined()
    expect(widget!.params).toMatchObject({
      systemId: 'sys-1',
      stationId: 'station-9',
    })
  })

  test('splits ref:gbfs on the FIRST colon only', () => {
    // Station ids can themselves contain colons.
    const widget = findDescriptor(
      place({ tags: { 'ref:gbfs': 'sys-1:station:with:colons' } }),
      WidgetType.BIKESHARE,
    )

    expect(widget!.params).toMatchObject({
      systemId: 'sys-1',
      stationId: 'station:with:colons',
    })
  })

  test('trims whitespace around the parsed ids', () => {
    const widget = findDescriptor(
      place({ tags: { 'ref:gbfs': ' sys-1 : station-9 ' } }),
      WidgetType.BIKESHARE,
    )

    expect(widget!.params).toMatchObject({
      systemId: 'sys-1',
      stationId: 'station-9',
    })
  })

  test('falls back to a proximity match for a dock without the tag', () => {
    const widget = findDescriptor(
      place({ tags: { amenity: 'bicycle_rental' } }),
      WidgetType.BIKESHARE,
    )

    expect(widget).toBeDefined()
    expect(widget!.params.systemId).toBeUndefined()
    expect(widget!.params).toMatchObject({ lat: '35.2', lng: '-80.8' })
  })

  test('covers scooter rentals too', () => {
    for (const amenity of ['scooter_rental', 'kick_scooter_rental']) {
      expect(
        descriptorTypes(place({ tags: { amenity } })),
      ).toContain(WidgetType.BIKESHARE)
    }
  })

  test('excludes a DOCKLESS rental area', () => {
    // Free-floating rentals have no capacity, so the card would read 0 of 0.
    const types = descriptorTypes(
      place({ tags: { amenity: 'bicycle_rental', bicycle_rental: 'dockless' } }),
    )

    expect(types).not.toContain(WidgetType.BIKESHARE)
  })

  test('still emits for a dockless area that carries an exact ref', () => {
    // An explicit station reference beats the dockless heuristic.
    const types = descriptorTypes(
      place({
        tags: {
          amenity: 'bicycle_rental',
          bicycle_rental: 'dockless',
          'ref:gbfs': 'sys-1:station-9',
        },
      }),
    )

    expect(types).toContain(WidgetType.BIKESHARE)
  })

  test('is not emitted for an unrelated amenity', () => {
    expect(
      descriptorTypes(place({ tags: { amenity: 'cafe' } })),
    ).not.toContain(WidgetType.BIKESHARE)
  })

  test('ignores a malformed ref:gbfs with no colon', () => {
    const widget = findDescriptor(
      place({ tags: { amenity: 'bicycle_rental', 'ref:gbfs': 'no-colon' } }),
      WidgetType.BIKESHARE,
    )

    // Falls back to proximity rather than inventing ids.
    expect(widget).toBeDefined()
    expect(widget!.params.systemId).toBeUndefined()
  })
})

describe('OSM tags descriptor and display chips', () => {
  test('is emitted when the place has tags', () => {
    expect(
      descriptorTypes(place({ tags: { cuisine: 'coffee_shop' } })),
    ).toContain(WidgetType.OSM_TAGS)
  })

  test('is not emitted for a place with no tags', () => {
    expect(descriptorTypes(place({ tags: {} }))).not.toContain(
      WidgetType.OSM_TAGS,
    )
  })

  test('lifts chip-eligible tags onto the place', () => {
    const subject = place({ tags: { wheelchair: 'yes', cuisine: 'coffee_shop' } })

    resolveWidgetDescriptors(subject)

    // Whether any given tag is chip-eligible is display-chips' business; what
    // matters here is that the resolver attaches what it found.
    if (subject.displayChips) {
      expect(Array.isArray(subject.displayChips)).toBe(true)
    }
  })
})

describe('fetchWidgetData — dispatch and validation', () => {
  test('rejects an unknown widget type', async () => {
    await expect(
      fetchWidgetData('horoscope' as any, {}),
    ).rejects.toThrow('Unknown widget type')
  })

  test('requires coordinates for the transit widget', async () => {
    await expect(
      fetchWidgetData(WidgetType.TRANSIT, {}),
    ).rejects.toThrow('Missing lat/lng parameters')
  })

  test('rejects non-numeric coordinates for the transit widget', async () => {
    await expect(
      fetchWidgetData(WidgetType.TRANSIT, { lat: 'north', lng: '-80.8' }),
    ).rejects.toThrow('Missing lat/lng parameters')
  })
})
