import { describe, expect, test } from 'bun:test'
import { fetchWidgetData, mapStationConnections } from './widget.service'
import { WidgetType } from '../types/place.types'

/**
 * Transit widget parameter contract: the endpoint serves both the place
 * sheet (coordinates from the place geometry) and the routed transit
 * stop/station detail pages. A stop-keyed lookup (GTFS feedId + stopId from
 * our own tiles) must work WITHOUT coordinates — Barrelman queries the stop
 * directly — so deep links to /transit/stop/:feedId/:stopId resolve.
 *
 * Barrelman is not configured in the unit-test environment, so valid
 * parameter shapes resolve to an empty departure board rather than data;
 * these tests pin the validation contract, not the fetch.
 */
describe('fetchWidgetData transit parameter contract', () => {
  test('rejects a lookup with neither coordinates nor a stop key', async () => {
    expect(fetchWidgetData(WidgetType.TRANSIT, {})).rejects.toThrow(
      /lat\/lng or feedId\/stopId/,
    )
  })

  test('rejects a half stop key without coordinates', async () => {
    expect(
      fetchWidgetData(WidgetType.TRANSIT, { feedId: '29' }),
    ).rejects.toThrow(/lat\/lng or feedId\/stopId/)
  })

  test('accepts a stop-keyed lookup without coordinates', async () => {
    const result = await fetchWidgetData(WidgetType.TRANSIT, {
      feedId: '29',
      stopId: '30374',
    })
    expect(result.type).toBe(WidgetType.TRANSIT)
    const info = result.data.value as { departures?: unknown[]; lat?: number }
    expect(Array.isArray(info.departures)).toBe(true)
    // No coordinates were passed and none resolved (no Barrelman) — the
    // widget must not fabricate a (NaN, NaN) or (0, 0) position.
    expect(info.lat ?? undefined).toBeUndefined()
  })

  test('accepts a coordinate lookup (existing place-sheet contract)', async () => {
    const result = await fetchWidgetData(WidgetType.TRANSIT, {
      lat: '41.8845',
      lng: '-87.6305',
      radius: '250',
    })
    expect(result.type).toBe(WidgetType.TRANSIT)
    const info = result.data.value as { lat?: number; lng?: number }
    expect(info.lat).toBe(41.8845)
    expect(info.lng).toBe(-87.6305)
  })
})

/**
 * Station "Connections" transform (Apple-Maps cross-reference between
 * same-name, close-but-distinct stations). Barrelman returns Jackson Red's
 * connections including Jackson (Blue); the widget flattens each route into an
 * id/shortName/color bullet the RouteBullet component renders.
 */
describe('mapStationConnections', () => {
  test('maps Barrelman connections (Jackson Red → Jackson Blue) into bullets', () => {
    const out = mapStationConnections({
      connections: [
        {
          feedId: '29',
          stopId: '40070',
          name: 'Jackson',
          distanceM: 133,
          routes: [
            {
              routeId: 'Blue',
              routeShortName: 'Blue',
              routeLongName: 'Blue Line',
              routeType: 1,
              routeColor: '00A1DE',
              routeTextColor: 'FFFFFF',
            },
          ],
        },
      ],
    })

    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      feedId: '29',
      stopId: '40070',
      name: 'Jackson',
      distanceM: 133,
    })
    expect(out[0].routes[0]).toMatchObject({
      id: 'Blue',
      shortName: 'Blue',
      color: '00A1DE',
      textColor: 'FFFFFF',
      type: 1,
    })
  })

  test('handles missing/empty connections and null route fields', () => {
    expect(mapStationConnections({})).toEqual([])
    const out = mapStationConnections({
      connections: [
        { feedId: '5', stopId: 'A38', name: 'Fulton Street', distanceM: 0, routes: [
          { routeId: 'A', routeShortName: null, routeColor: null, routeTextColor: null },
        ] },
      ],
    })
    expect(out[0].routes[0]).toMatchObject({
      id: 'A',
      shortName: undefined,
      color: undefined,
      textColor: undefined,
    })
  })
})
