import { describe, it, expect } from 'vitest'
import {
  buildCollectionMarkersGeoJSON,
  collectionMarkerSpec,
  collectionMarkerSpecs,
} from './collection-markers'
import { markerImageId, markerPaint } from '@/lib/map-marker'
import { FREQUENT_META } from '@/lib/frequents'
import type { Bookmark } from '@/types/library.types'

function bookmark(overrides: Partial<Bookmark> = {}): Bookmark {
  return {
    id: 'bm-1',
    externalIds: { osm: 'node/1' },
    name: 'Cafe',
    lat: 35.2,
    lng: -80.8,
    icon: 'coffee',
    iconPack: 'maki',
    iconColor: '#d97706',
    userId: 'u',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }
}

const identity = (c: string) => c

describe('collectionMarkerSpec', () => {
  it('draws the place in its own icon, tinted as a POI marker', () => {
    expect(collectionMarkerSpec(bookmark(), identity, false)).toEqual({
      shape: 'disc',
      pack: 'maki',
      name: 'coffee',
      paint: markerPaint('#d97706', 'disc', false),
    })
  })

  it('draws a frequent in the look fixed by its type', () => {
    const spec = collectionMarkerSpec(
      bookmark({ frequentType: 'home' }),
      identity,
      false,
    )
    expect(spec.name).toBe(FREQUENT_META.home.icon)
    expect(spec.pack).toBe('lucide')
  })

  it('resolves theme colour names before tinting', () => {
    const spec = collectionMarkerSpec(
      bookmark({ iconColor: 'cobalt' }),
      () => '#2563eb',
      true,
    )
    expect(spec.paint).toEqual(markerPaint('#2563eb', 'disc', true))
  })
})

describe('buildCollectionMarkersGeoJSON', () => {
  it('names the baked marker image each feature draws with', () => {
    const [feature] = buildCollectionMarkersGeoJSON([bookmark()], identity, false).features
    const spec = collectionMarkerSpec(bookmark(), identity, false)
    expect(feature.properties.markerImage).toBe(markerImageId(spec))
    expect(feature.properties.ink).toBe(spec.paint.ink)
    expect(feature.geometry.coordinates).toEqual([-80.8, 35.2])
  })

  it('skips places without coordinates', () => {
    const places = [bookmark(), bookmark({ id: 'bm-2', lat: NaN })]
    expect(buildCollectionMarkersGeoJSON(places, identity, false).features).toHaveLength(1)
    expect(collectionMarkerSpecs(places, identity, false)).toHaveLength(1)
  })
})
