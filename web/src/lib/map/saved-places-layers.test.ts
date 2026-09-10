/**
 * The saved-places projection is where the layer selector and the map layer
 * agree on what is switched on, so the two invariants worth pinning down are:
 *
 *   - the group acts as a MASTER switch, not a cascade — turning it off hides
 *     everything without clobbering each collection's own state, so turning it
 *     back on restores exactly what was showing before;
 *   - bookmarks in no collection get their own bucket, because otherwise they
 *     would be unreachable from the selector entirely.
 */

import { describe, it, expect } from 'vitest'
import {
  buildSavedPlacesProjection,
  collectionLayerId,
  collectionIdFromLayerId,
  isVirtualLayerId,
  SAVED_PLACES_GROUP_ID,
  UNCATEGORIZED_LAYER_ID,
  FREQUENTS_LAYER_ID,
} from './saved-places-layers'
import type { Bookmark, Collection } from '@/types/library.types'

function bookmark(id: string, collectionIds: string[] = []): Bookmark {
  return {
    id,
    externalIds: { osm: `node/${id}` },
    name: `Place ${id}`,
    lat: 35.2,
    lng: -80.8,
    icon: 'map-pin',
    iconColor: '#F43F5E',
    userId: 'user-1',
    createdAt: '',
    updatedAt: '',
    collectionIds,
  }
}

function collection(id: string, name: string): Collection {
  return {
    id,
    userId: 'user-1',
    isPublic: false,
    scheme: 'server-key',
    resharingPolicy: 'owner-only',
    createdAt: '',
    updatedAt: '',
    name,
    iconColor: '#3B82F6',
  } as Collection
}

const build = (overrides: Partial<Parameters<typeof buildSavedPlacesProjection>[0]> = {}) =>
  buildSavedPlacesProjection({
    collections: [collection('col-1', 'Coffee'), collection('col-2', 'Trips')],
    bookmarks: [
      bookmark('bm-1', ['col-1']),
      bookmark('bm-2', ['col-1']),
      bookmark('bm-3', ['col-2']),
      bookmark('bm-4'),
    ],
    layerOverrides: {},
    groupOverrides: {},
    groupLabel: 'Saved places',
    frequentsLabel: 'Frequents',
    uncategorizedLabel: 'Unfiled',
    lockedLabel: 'Locked collection',
    ...overrides,
  })

describe('id helpers', () => {
  it('round-trips a collection id through its layer id', () => {
    expect(collectionIdFromLayerId(collectionLayerId('col-9'))).toBe('col-9')
  })

  it('reports no collection for the uncategorized bucket', () => {
    expect(collectionIdFromLayerId(UNCATEGORIZED_LAYER_ID)).toBeNull()
  })

  it('recognises virtual ids so mutations can skip them', () => {
    expect(isVirtualLayerId(SAVED_PLACES_GROUP_ID)).toBe(true)
    expect(isVirtualLayerId(collectionLayerId('col-1'))).toBe(true)
    expect(isVirtualLayerId('default:cycling')).toBe(false)
  })
})

describe('buildSavedPlacesProjection', () => {
  it('projects one layer per non-empty collection, plus an unfiled bucket', () => {
    const { group, layers } = build()

    expect(group?.id).toBe(SAVED_PLACES_GROUP_ID)
    expect(layers.map(l => l.name)).toEqual(['Coffee', 'Trips', 'Unfiled'])
    expect(layers.every(l => l.origin === 'virtual')).toBe(true)
    expect(layers.every(l => l.groupId === SAVED_PLACES_GROUP_ID)).toBe(true)
  })

  it('omits collections that hold none of the user’s bookmarks', () => {
    const { layers } = build({
      collections: [
        collection('col-1', 'Coffee'),
        collection('col-empty', 'Empty'),
      ],
      bookmarks: [bookmark('bm-1', ['col-1'])],
    })

    expect(layers.map(l => l.name)).toEqual(['Coffee'])
  })

  it('drops the group entirely when nothing is saved', () => {
    const projection = build({ bookmarks: [] })

    expect(projection.group).toBeNull()
    expect(projection.layers).toEqual([])
    expect(projection.visibility.enabled).toBe(false)
  })

  it('defaults everything on, so a saved place is visible without hunting for a toggle', () => {
    const { visibility } = build()

    expect(visibility.enabled).toBe(true)
    expect([...visibility.collectionIds].sort()).toEqual(['col-1', 'col-2'])
    expect(visibility.uncategorized).toBe(true)
  })

  it('hides only the collection the user switched off', () => {
    const { visibility } = build({
      layerOverrides: { [collectionLayerId('col-1')]: false },
    })

    expect([...visibility.collectionIds]).toEqual(['col-2'])
    expect(visibility.uncategorized).toBe(true)
  })

  it('hides the unfiled bucket independently of the collections', () => {
    const { visibility } = build({
      layerOverrides: { [UNCATEGORIZED_LAYER_ID]: false },
    })

    expect([...visibility.collectionIds].sort()).toEqual(['col-1', 'col-2'])
    expect(visibility.uncategorized).toBe(false)
  })

  it('masks every child when the group is off but leaves their own state intact', () => {
    const { layers, visibility } = build({
      groupOverrides: { [SAVED_PLACES_GROUP_ID]: false },
    })

    expect(visibility.enabled).toBe(false)
    expect(visibility.collectionIds.size).toBe(0)
    expect(visibility.uncategorized).toBe(false)
    // The children still read as on — flipping the group back restores them.
    expect(layers.every(l => l.visible)).toBe(true)
  })

  it('carries each collection’s icon pack, color and count for the selector', () => {
    const { meta } = build()

    expect(meta.get(collectionLayerId('col-1'))).toEqual({
      iconPack: 'lucide',
      iconColor: '#3B82F6',
      count: 2,
    })
    expect(meta.get(UNCATEGORIZED_LAYER_ID)?.count).toBe(1)
  })

  it('labels an undecryptable collection as locked, not unfiled', () => {
    // A device that hasn't imported the recovery key can't read collection
    // metadata. Falling back to the unfiled label would put two identical
    // rows in the selector.
    const { layers } = build({
      collections: [{ ...collection('col-1', ''), name: undefined } as Collection],
      bookmarks: [bookmark('bm-1', ['col-1']), bookmark('bm-2')],
    })

    expect(layers.map(l => l.name)).toEqual(['Locked collection', 'Unfiled'])
  })

  it('buckets frequents separately from unfiled places', () => {
    // Frequents are standalone by design; lumping them under "Unfiled" reads
    // as though the user forgot to file them.
    const { layers, meta } = build({
      bookmarks: [
        bookmark('bm-1', ['col-1']),
        { ...bookmark('bm-2'), frequentType: 'home' } as Bookmark,
        { ...bookmark('bm-3'), frequentType: 'custom' } as Bookmark,
      ],
      collections: [collection('col-1', 'Coffee')],
    })

    expect(layers.map(l => l.name)).toEqual(['Frequents', 'Coffee'])
    expect(meta.get(FREQUENTS_LAYER_ID)?.count).toBe(2)
    // No unfiled bucket: every non-frequent bookmark is in a collection.
    expect(meta.has(UNCATEGORIZED_LAYER_ID)).toBe(false)
  })

  it('does not count a frequent toward its collection', () => {
    const { visibility } = build({
      bookmarks: [{ ...bookmark('bm-1'), frequentType: 'home' } as Bookmark],
      collections: [],
    })

    expect(visibility.frequents).toBe(true)
    expect(visibility.collectionIds.size).toBe(0)
  })

  it('keeps an encrypted collection even though it holds no bookmark rows', () => {
    // A user-e2ee collection's places live in `encrypted_points` and only
    // decrypt once it's switched on. Counting bookmarks alone would drop it
    // from the selector — leaving no toggle to switch on, so it could never
    // load. That made the whole encrypted path unreachable.
    const e2ee = { ...collection('col-enc', 'Private'), scheme: 'user-e2ee' } as Collection
    const { layers, visibility } = build({
      collections: [collection('col-1', 'Coffee'), e2ee],
      bookmarks: [bookmark('bm-1', ['col-1'])],
    })

    expect(layers.map(l => l.name)).toContain('Private')
    expect(visibility.collectionIds.has('col-enc')).toBe(true)
  })

  it('still builds the group when the only saved data is encrypted', () => {
    const e2ee = { ...collection('col-enc', 'Private'), scheme: 'user-e2ee' } as Collection
    const { group, layers } = build({ collections: [e2ee], bookmarks: [] })

    expect(group).not.toBeNull()
    expect(layers.map(l => l.name)).toEqual(['Private'])
  })

  it('sorts the group above every real group', () => {
    const { group } = build()

    expect(group!.order).toBeLessThan(0)
  })
})
