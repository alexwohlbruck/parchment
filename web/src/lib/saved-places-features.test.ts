/**
 * Two things decide what a saved place looks like on the map, and both are
 * easy to get subtly wrong:
 *
 *   - WHETHER it draws — multi-collection membership, the unfiled bucket, and
 *     E2EE points that live in a different store entirely;
 *   - WHAT it looks like — a place wears its parent COLLECTION's icon and
 *     colour, never its own, except frequents, which wear the look fixed by
 *     their type because they belong to no collection.
 *
 * A place filed in several collections wears the most recently added one, so
 * `collectionIds` order is load-bearing rather than incidental.
 */

import { describe, it, expect } from 'vitest'
import {
  selectSavedPlaces,
  buildSavedPlacesGeoJSON,
  savedPlaceIconSpecs,
} from './saved-places-features'
import type { SavedPlacesVisibility } from './saved-places-layers'
import { FREQUENT_META, CUSTOM_FREQUENT_ICON } from './frequents'
import type { Bookmark, DecryptedPoint } from '@/types/library.types'

function bookmark(overrides: Partial<Bookmark> = {}): Bookmark {
  return {
    id: 'bm-1',
    externalIds: { osm: 'node/1' },
    name: 'Cafe',
    lat: 35.2,
    lng: -80.8,
    // The POI's own look. Collection lists render from this; the map never does.
    icon: 'cafe',
    iconPack: 'maki',
    iconColor: 'coral',
    userId: 'user-1',
    createdAt: '',
    updatedAt: '',
    collectionIds: [],
    ...overrides,
  }
}

function point(overrides: Partial<DecryptedPoint> = {}): DecryptedPoint {
  return {
    id: 'pt-1',
    externalIds: { osm: 'node/9' },
    name: 'Secret spot',
    lat: 40.7,
    lng: -74,
    icon: 'lodging',
    iconColor: 'moss',
    ...overrides,
  }
}

function visibility(
  overrides: Partial<SavedPlacesVisibility> = {},
): SavedPlacesVisibility {
  return {
    enabled: true,
    collectionIds: new Set(['col-1']),
    frequents: true,
    uncategorized: true,
    ...overrides,
  }
}

const STYLES = {
  'col-1': { icon: 'Coffee', iconPack: 'lucide' as const, iconColor: 'compass' },
  'col-2': { icon: 'Plane', iconPack: 'lucide' as const, iconColor: 'teal' },
}

const select = (params: Partial<Parameters<typeof selectSavedPlaces>[0]> = {}) =>
  selectSavedPlaces({
    bookmarks: [],
    pointsByCollection: {},
    visibility: visibility(),
    collectionStyles: STYLES,
    ...params,
  })

describe('which places draw', () => {
  it('draws nothing when the group is switched off', () => {
    expect(select({ bookmarks: [bookmark()], visibility: visibility({ enabled: false }) }))
      .toEqual([])
  })

  it('governs an unfiled bookmark by the uncategorized toggle', () => {
    expect(
      select({
        bookmarks: [bookmark()],
        visibility: visibility({ uncategorized: true }),
      }),
    ).toHaveLength(1)
    expect(
      select({
        bookmarks: [bookmark()],
        visibility: visibility({ uncategorized: false }),
      }),
    ).toHaveLength(0)
  })

  it('keeps a bookmark visible while ANY of its collections is on', () => {
    // Hiding one collection must not remove a place the user can still see
    // through another.
    expect(
      select({
        bookmarks: [bookmark({ collectionIds: ['col-hidden', 'col-1'] })],
      }),
    ).toHaveLength(1)
  })

  it('hides a bookmark only when every collection it is in is off', () => {
    expect(
      select({ bookmarks: [bookmark({ collectionIds: ['col-a', 'col-b'] })] }),
    ).toEqual([])
  })

  it('does not fall back to the unfiled toggle for a filed bookmark', () => {
    // A bookmark in a hidden collection stays hidden even when unfiled places
    // are showing.
    expect(
      select({
        bookmarks: [bookmark({ collectionIds: ['col-hidden'] })],
        visibility: visibility({ collectionIds: new Set(), uncategorized: true }),
      }),
    ).toEqual([])
  })

  it('merges decrypted points from visible E2EE collections only', () => {
    const places = select({
      pointsByCollection: {
        'col-1': [point()],
        'col-hidden': [point({ id: 'pt-2' })],
      },
    })

    expect(places.map(p => p.id)).toEqual(['pt-1'])
  })

  it('governs frequents by the frequents toggle, not the unfiled one', () => {
    // A frequent has no collection, but it isn't "unfiled" — it's its own
    // bucket, with its own switch in the layer selector.
    const bookmarks = [bookmark({ frequentType: 'home' })]

    expect(
      select({ bookmarks, visibility: visibility({ frequents: false }) }),
    ).toEqual([])
    expect(
      select({
        bookmarks,
        visibility: visibility({ frequents: true, uncategorized: false }),
      }),
    ).toHaveLength(1)
  })

  it('skips places with no usable coordinates rather than emitting NaN geometry', () => {
    const places = select({
      bookmarks: [
        bookmark({ id: 'ok' }),
        bookmark({ id: 'no-lat', lat: undefined as any }),
        bookmark({ id: 'nan', lng: NaN }),
      ],
    })

    expect(places.map(p => p.id)).toEqual(['ok'])
  })
})

describe('what places look like', () => {
  it('dresses a bookmark in its collection’s icon and colour, not its own', () => {
    const [place] = select({
      bookmarks: [bookmark({ collectionIds: ['col-1'] })],
    })

    expect(place.icon).toBe('Coffee')
    expect(place.iconPack).toBe('lucide')
    expect(place.iconColor).toBe('compass')
    // Explicitly NOT the POI's own maki cafe glyph.
    expect(place.icon).not.toBe('cafe')
  })

  it('uses the most recently added collection when a place is in several', () => {
    // The list endpoint orders `collectionIds` newest-first, so index 0 wins.
    const [place] = select({
      bookmarks: [bookmark({ collectionIds: ['col-2', 'col-1'] })],
      visibility: visibility({ collectionIds: new Set(['col-1', 'col-2']) }),
    })

    expect(place.icon).toBe('Plane')
    expect(place.iconColor).toBe('teal')
  })

  it('skips a hidden collection when choosing the look', () => {
    // Styling after a switched-off collection would paint a dot in the colours
    // of something the user asked not to see.
    const [place] = select({
      bookmarks: [bookmark({ collectionIds: ['col-hidden', 'col-1'] })],
      visibility: visibility({ collectionIds: new Set(['col-1']) }),
    })

    expect(place.iconColor).toBe('compass')
  })

  it('gives a canonical frequent its own fixed look', () => {
    // Frequents belong to no collection, so their type decides how they look.
    const [place] = select({
      bookmarks: [bookmark({ frequentType: 'home' })],
    })

    expect(place.icon).toBe(FREQUENT_META.home.icon)
    expect(place.iconColor).toBe(FREQUENT_META.home.color)
  })

  it('gives a custom frequent the fixed star look', () => {
    const [place] = select({
      bookmarks: [bookmark({ frequentType: 'custom' })],
    })

    expect(place.icon).toBe(CUSTOM_FREQUENT_ICON)
  })

  it('lets a frequent’s look win over any collection it happens to be in', () => {
    const [place] = select({
      bookmarks: [bookmark({ frequentType: 'work', collectionIds: ['col-1'] })],
    })

    expect(place.icon).toBe(FREQUENT_META.work.icon)
  })

  it('falls back to a bookmark glyph for a collection that has no style yet', () => {
    // e.g. a collection whose metadata hasn't decrypted on this device.
    const [place] = select({
      bookmarks: [bookmark({ collectionIds: ['col-unknown'] })],
      visibility: visibility({ collectionIds: new Set(['col-unknown']) }),
    })

    expect(place.icon).toBe('Bookmark')
    expect(place.iconPack).toBe('lucide')
  })

  it('runs the resolved colour through the caller’s resolver', () => {
    // Collection colours are ThemeColor NAMES; handing one straight to a paint
    // expression renders nothing.
    const [place] = select({
      bookmarks: [bookmark({ collectionIds: ['col-1'] })],
      resolveColor: c => (c === 'compass' ? '#B45309' : c),
    })

    expect(place.iconColor).toBe('#B45309')
  })
})

describe('buildSavedPlacesGeoJSON', () => {
  it('emits lng/lat order and the properties the layers read', () => {
    const geojson = buildSavedPlacesGeoJSON(
      select({ bookmarks: [bookmark({ collectionIds: ['col-1'] })] }),
    )

    expect(geojson.features[0].geometry.coordinates).toEqual([-80.8, 35.2])
    expect(geojson.features[0].properties).toEqual({
      id: 'bm-1',
      icon: 'Coffee',
      iconPack: 'lucide',
      iconColor: 'compass',
    })
  })

  it('carries no name — places on the map are unlabelled', () => {
    const geojson = buildSavedPlacesGeoJSON(select({ bookmarks: [bookmark()] }))

    expect('name' in geojson.features[0].properties).toBe(false)
  })
})

describe('savedPlaceIconSpecs', () => {
  it('reports the collection glyphs that need registering as map images', () => {
    const specs = savedPlaceIconSpecs(
      select({
        bookmarks: [
          bookmark({ id: 'bm-1', collectionIds: ['col-1'] }),
          bookmark({ id: 'bm-2', frequentType: 'home' }),
        ],
      }),
    )

    expect(specs).toEqual([
      { pack: 'lucide', name: 'Coffee' },
      { pack: 'lucide', name: FREQUENT_META.home.icon },
    ])
  })
})
