import { describe, it, expect } from 'vitest'
import {
  buildRecentPlacesGeoJSON,
  recentPlaceMarkerSpec,
  selectRecentPlaceMarkers,
} from './recent-place-markers'
import { markerImageId } from '@/lib/map-marker'
import type { RecentPlaceEntry } from '@/lib/recents'

function recent(id: string, overrides: Partial<RecentPlaceEntry> = {}): RecentPlaceEntry {
  return { id, title: id, lat: 40.7, lng: -74, at: 0, ...overrides }
}

const ids = (places: RecentPlaceEntry[]) => places.map(p => p.id)

describe('selectRecentPlaceMarkers', () => {
  it('keeps the newest entries up to the limit', () => {
    const entries = ['osm/node/1', 'osm/node/2', 'osm/node/3'].map(id => recent(id))
    expect(ids(selectRecentPlaceMarkers({ entries, saved: [], limit: 2 }))).toEqual([
      'osm/node/1',
      'osm/node/2',
    ])
  })

  it('skips transit lines and entries without coordinates', () => {
    const entries = [
      recent('transit-route/mta:A', { lat: undefined, lng: undefined }),
      recent('transit-route/mta:B'),
      recent('osm/node/1', { lat: undefined }),
      recent('osm/node/2'),
    ]
    expect(ids(selectRecentPlaceMarkers({ entries, saved: [] }))).toEqual(['osm/node/2'])
  })

  it('leaves saved and selected places to their own markers', () => {
    const entries = ['osm/node/1', 'osm/way/2', 'coords/40.7/-74', 'osm/node/4'].map(id =>
      recent(id),
    )
    const result = selectRecentPlaceMarkers({
      entries,
      saved: [{ osm: 'way/2' }, { coords: '40.7/-74' }],
      selectedId: 'osm/node/4',
    })
    expect(ids(result)).toEqual(['osm/node/1'])
  })

  it('fills the limit from older entries when newer ones are excluded', () => {
    const entries = ['osm/node/1', 'osm/node/2', 'osm/node/3'].map(id => recent(id))
    const result = selectRecentPlaceMarkers({
      entries,
      saved: [{ osm: 'node/1' }],
      limit: 2,
    })
    expect(ids(result)).toEqual(['osm/node/2', 'osm/node/3'])
  })
})

describe('recentPlaceMarkerSpec', () => {
  it('draws the place icon in one muted tint, whatever its category', () => {
    const cafe = recentPlaceMarkerSpec(
      recent('osm/node/1', { icon: 'cafe', iconPack: 'maki', category: 'food_and_drink' }),
      false,
    )
    const park = recentPlaceMarkerSpec(
      recent('osm/node/2', { icon: 'park', iconPack: 'maki', category: 'park' }),
      false,
    )
    expect(cafe).toMatchObject({ shape: 'disc', pack: 'maki', name: 'cafe' })
    expect(cafe.paint).toEqual(park.paint)
  })

  it('falls back to a history glyph for a place without an icon', () => {
    expect(recentPlaceMarkerSpec(recent('coords/1/2'), false)).toMatchObject({
      pack: 'lucide',
      name: 'History',
    })
  })
})

describe('buildRecentPlacesGeoJSON', () => {
  it('builds one point per place, ranked newest first', () => {
    const places = [recent('osm/node/1', { lng: -73.9 }), recent('osm/node/2')]
    const { features } = buildRecentPlacesGeoJSON(places as any, true)
    expect(features).toHaveLength(2)
    expect(features[0].geometry.coordinates).toEqual([-73.9, 40.7])
    expect(features[0].properties).toMatchObject({
      id: 'osm/node/1',
      name: 'osm/node/1',
      sortKey: 0,
      markerImage: markerImageId(recentPlaceMarkerSpec(places[0], true)),
    })
    expect(features[1].properties.sortKey).toBe(1)
  })
})
