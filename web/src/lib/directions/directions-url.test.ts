import { describe, it, expect } from 'vitest'
import {
  serializeDirectionsQuery,
  parseDirectionsQuery,
  directionsQueryEquals,
  shareableWaypointId,
} from './directions-url'

describe('directions-url', () => {
  it('round-trips waypoints, mode, sort, and departure', () => {
    const q = serializeDirectionsQuery({
      waypoints: [
        { lat: 35.2171225582967, lng: -80.82020567948554, label: 'Current Location' },
        { lat: 35.225773265, lng: -80.85278523, label: 'Bank of America Stadium' },
      ],
      mode: 'multi',
      sort: 'cheapest',
      depart: '2026-06-12T18:00:00Z',
    })
    expect(q.wp).toEqual([
      '35.217123,-80.820206,Current Location',
      '35.225773,-80.852785,Bank of America Stadium',
    ])

    const parsed = parseDirectionsQuery(q as never)!
    expect(parsed.waypoints).toHaveLength(2)
    expect(parsed.waypoints[0].lat).toBeCloseTo(35.217123, 6)
    expect(parsed.waypoints[0].label).toBe('Current Location')
    expect(parsed.waypoints[1].label).toBe('Bank of America Stadium')
    expect(parsed.mode).toBe('multi')
    expect(parsed.sort).toBe('cheapest')
    expect(parsed.depart).toBe('2026-06-12T18:00:00Z')
  })

  it('keeps commas inside labels', () => {
    const parsed = parseDirectionsQuery({
      wp: '40.7,-73.9,123 Main St, Brooklyn, NY',
    } as never)!
    expect(parsed.waypoints[0].label).toBe('123 Main St, Brooklyn, NY')
  })

  it('handles a single wp param and missing labels', () => {
    const parsed = parseDirectionsQuery({ wp: '40.7,-73.9' } as never)!
    expect(parsed.waypoints).toEqual([{ lat: 40.7, lng: -73.9 }])
  })

  it('rejects malformed and out-of-range coordinates', () => {
    expect(parseDirectionsQuery({ wp: 'abc,def' } as never)).toBeNull()
    expect(parseDirectionsQuery({ wp: '95,-200' } as never)).toBeNull()
    expect(parseDirectionsQuery({} as never)).toBeNull()
  })

  it('directionsQueryEquals compares only directions keys', () => {
    const q = serializeDirectionsQuery({
      waypoints: [{ lat: 1, lng: 2 }],
      mode: 'transit',
    })
    expect(
      directionsQueryEquals(q, {
        wp: '1.000000,2.000000',
        mode: 'transit',
        unrelated: 'x',
      } as never),
    ).toBe(true)
    expect(
      directionsQueryEquals(q, { wp: '1.000000,2.000000', mode: 'driving' } as never),
    ).toBe(false)
  })

  it('carries place ids alongside the waypoints they belong to', () => {
    const q = serializeDirectionsQuery({
      waypoints: [
        { lat: 40.6702, lng: -73.955, label: 'Current Location' },
        { lat: 40.684397, lng: -73.97644, label: 'Target', id: 'osm/node/6308438190' },
      ],
    })
    expect(q.wpid).toEqual(['', 'osm/node/6308438190'])

    const parsed = parseDirectionsQuery(q as never)!
    expect(parsed.waypoints[0].id).toBeUndefined()
    expect(parsed.waypoints[1].id).toBe('osm/node/6308438190')
  })

  it('omits the id list when no waypoint has one', () => {
    const q = serializeDirectionsQuery({
      waypoints: [
        { lat: 40.6702, lng: -73.955 },
        { lat: 40.684397, lng: -73.97644 },
      ],
    })
    expect(q.wpid).toBeUndefined()
  })

  // A malformed wp is dropped but still holds its slot, so the ids after it
  // stay attached to the right stops.
  it('keeps ids aligned when a waypoint is unparseable', () => {
    const parsed = parseDirectionsQuery({
      wp: ['not-a-coord', '40.684397,-73.976440,Target'],
      wpid: ['osm/node/1', 'osm/node/2'],
    } as never)!
    expect(parsed.waypoints).toHaveLength(1)
    expect(parsed.waypoints[0].id).toBe('osm/node/2')
  })

  it('treats the id list as part of the query when comparing', () => {
    const q = serializeDirectionsQuery({
      waypoints: [{ lat: 1, lng: 2, id: 'osm/node/1' }],
    })
    expect(directionsQueryEquals(q, { wp: q.wp } as never)).toBe(false)
    expect(directionsQueryEquals(q, q as never)).toBe(true)
  })
})

describe('shareableWaypointId', () => {
  it('shares ids that name a source', () => {
    expect(shareableWaypointId({ id: 'osm/node/6308438190' })).toBe('osm/node/6308438190')
  })

  it('withholds ids that mean nothing on another device', () => {
    expect(shareableWaypointId(null)).toBeUndefined()
    expect(shareableWaypointId({ id: 'current-location' })).toBeUndefined()
    expect(shareableWaypointId({ id: 'shared-wp-0' })).toBeUndefined()
    // A bookmark id is a bare uuid — private to the user who saved it.
    expect(shareableWaypointId({ id: 'vAzo3WtqLXuZu7Oe4FW6ok6a' })).toBeUndefined()
  })
})
