import { beforeEach, describe, expect, mock, test } from 'bun:test'
import type { AskContext } from './ask-tool-base'

mock.module('../auth.service', () => ({
  getPermissions: async () => ['library:write'],
  hasPermission: (held: string[], rule: string) => held.includes(rule),
}))

let existing: { bookmark: { id: string }; collectionIds: string[] } | null = null
const mockCreate = mock(async (_params: any, _collectionIds: string[]) => ({}))
const mockUpdate = mock(async (_id: string, _userId: string, _updates: any) => null)
mock.module('../library/bookmarks.service', () => ({
  getBookmarks: async () => [],
  searchBookmarks: async () => [],
  getFrequentBookmarks: async () => [],
  createBookmark: mockCreate,
  updateBookmark: mockUpdate,
  findBookmarkByExternalIds: async () => existing,
}))
mock.module('../library/collections.service', () => ({
  getCollections: async () => [
    { id: 'private', scheme: 'user-e2ee', name: null, metadataEncrypted: 'x', archivedAt: null },
    { id: 'first', scheme: 'server-key', name: null, metadataEncrypted: null, archivedAt: null },
    { id: 'legacy', scheme: 'server-key', name: null, metadataEncrypted: 'x', archivedAt: null },
    { id: 'pizza', scheme: 'server-key', name: 'Pizza', metadataEncrypted: null, archivedAt: null },
    { id: 'gone', scheme: 'server-key', name: 'Gone', metadataEncrypted: null, archivedAt: new Date() },
  ],
  getBookmarksInCollection: async (id: string) =>
    id === 'pizza' ? [{ name: "Joe's" }, { name: "L'industrie" }, { name: "Scarr's" }, { name: 'Lucali' }] : [],
}))
mock.module('../vehicle.service', () => ({ getUserVehicles: async () => [], getActiveVehicles: async () => [] }))
mock.module('../geocoding.service', () => ({
  forwardGeocode: async () => ({ results: [] }),
  reverseGeocode: async () => ({ results: [] }),
}))
mock.module('../place.service', () => ({ lookupEnrichedPlaceById: async () => null }))

const { libraryTools } = await import('./ask-library-tools')
const tool = (name: string) => libraryTools.find((t) => t.name === name)!

const joes = {
  id: 'osm/node/1',
  externalIds: { osm: 'node/1' },
  name: { value: "Joe's Pizza" },
  address: { value: { formatted: '7 Carmine St' } },
  icon: { icon: 'pizza', iconPack: 'lucide', category: 'food' },
  geometry: { value: { center: { lat: 40.7306, lng: -73.9894 } } },
} as any

function context(): AskContext {
  return {
    userId: 'u1',
    language: 'en-US',
    places: new Map(),
    units: 'metric',
    vehicles: [],
    now: new Date('2026-11-20T15:00:00Z'),
    seen: new Map([[joes.id, joes]]),
    routes: new Map(),
    sources: new Map(),
    emit: () => {},
  }
}

beforeEach(() => {
  existing = null
  mockCreate.mockClear()
  mockUpdate.mockClear()
})

describe('my_collections', () => {
  test('lists the live collections a saved place can join, with a few of their places', async () => {
    expect(await tool('my_collections').run({}, context())).toEqual([
      { id: 'first', name_hidden: true, places: 0 },
      { id: 'legacy', name_hidden: true, places: 0 },
      { id: 'pizza', name: 'Pizza', places: 4, for_example: ["Joe's", "L'industrie", "Scarr's"] },
    ])
  })
})

describe('save_place', () => {
  test('saves a found place into the chosen collection', async () => {
    const result = await tool('save_place').run({ place: joes.id, collection_id: 'pizza' }, context())
    expect(mockCreate.mock.calls[0]).toEqual([
      {
        userId: 'u1',
        externalIds: { osm: 'node/1' },
        name: "Joe's Pizza",
        address: '7 Carmine St',
        lat: 40.7306,
        lng: -73.9894,
        icon: 'pizza',
        iconPack: 'lucide',
      },
      ['pizza'],
    ])
    expect(result).toEqual({ saved: true, name: "Joe's Pizza", collection: 'Pizza' })
  })

  test('adds a place already saved elsewhere to the first collection instead of saving it twice', async () => {
    existing = { bookmark: { id: 'bm-1' }, collectionIds: ['pizza'] }
    await tool('save_place').run({ place: joes.id }, context())
    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockUpdate.mock.calls[0]).toEqual(['bm-1', 'u1', { collectionIds: ['pizza', 'first'] }])
  })

  test('refuses bare coordinates and collections it may not write', async () => {
    await expect(tool('save_place').run({ place: { lat: 1, lng: 2 } }, context())).rejects.toThrow(
      'Only a place a tool returned',
    )
    await expect(tool('save_place').run({ place: joes.id, collection_id: 'private' }, context())).rejects.toThrow(
      'Unknown collection private',
    )
  })
})
