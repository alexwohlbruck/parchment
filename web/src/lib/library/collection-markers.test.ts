import { describe, it, expect } from 'vitest'
import {
  buildCollectionMarkersGeoJSON,
  collectionMarkerSpec,
  drawableBookmarks,
} from './collection-markers'
import { markerPaint } from '@/lib/map-marker'
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
  it('draws each place with its mark, in list order', () => {
    const marks = [{ image: 'poi|badge-coffee|#a|#b|#c|#d', ink: '#b' }]
    const [feature] = buildCollectionMarkersGeoJSON([bookmark()], marks).features
    expect(feature.properties).toMatchObject({ markerImage: marks[0].image, ink: '#b', sortKey: 0 })
    expect(feature.geometry.coordinates).toEqual([-80.8, 35.2])
  })
})

describe('drawableBookmarks', () => {
  it('skips places without coordinates', () => {
    const places = [bookmark(), bookmark({ id: 'bm-2', lat: NaN })]
    expect(drawableBookmarks(places)).toHaveLength(1)
  })
})
