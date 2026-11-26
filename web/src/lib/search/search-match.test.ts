import { describe, it, expect, vi } from 'vitest'
import type { SearchResult } from '@/types/search.types'

vi.mock('@/router', () => ({
  AppRoute: {
    ASK: 'ask',
    SEARCH_RESULTS: 'search-results',
    PLACE: 'place',
    PLACE_LOCATION: 'place-location',
  },
}))

const { searchMatchRoute } = await import('./search-match')

const result = (fields: Partial<SearchResult> & Pick<SearchResult, 'id' | 'type'>): SearchResult => ({
  title: '',
  metadata: {},
  ...fields,
})

describe('searchMatchRoute', () => {
  it('browses the category a query names', () => {
    expect(searchMatchRoute({
      match: 'amenity/cafe',
      results: [result({ id: 'amenity/cafe', type: 'category', title: 'Cafe', iconCategory: 'food_and_drink' })],
    })).toEqual({
      name: 'search-results',
      query: { categoryId: 'amenity/cafe', categoryName: 'Cafe', categoryIconCategory: 'food_and_drink' },
    })
  })

  it('browses a filtered category ahead of any match', () => {
    expect(searchMatchRoute({
      match: 'node/1',
      intent: { intent: 'browse', category: { id: 'amenity/cafe', name: 'Cafe' }, openNow: true, residual: '' },
      results: [result({ id: 'node/1', type: 'place' })],
    })).toEqual({
      name: 'search-results',
      query: { categoryId: 'amenity/cafe', categoryName: 'Cafe', 'f.openNow': '1' },
    })
  })

  it('lists every location of a brand', () => {
    expect(searchMatchRoute({
      match: 'Q37158',
      results: [result({
        id: 'Q37158',
        type: 'brand',
        title: 'Starbucks',
        metadata: { brand: { brandKey: 'Q37158', name: 'Starbucks' } },
      })],
    })).toEqual({ name: 'search-results', query: { brandKey: 'Q37158', brandName: 'Starbucks' } })
  })

  it('opens a place', () => {
    expect(searchMatchRoute({
      match: 'osm/node/1',
      results: [result({ id: 'osm/node/1', type: 'place', metadata: { place: { id: 'osm/node/1' } as any } })],
    })).toEqual({ name: 'place', params: { type: 'node', id: '1' } })
  })

  it('opens a GTFS-only stop at its coordinates', () => {
    expect(searchMatchRoute({
      match: 'gtfs/stop',
      results: [result({
        id: 'gtfs/stop',
        type: 'transit_stop',
        title: 'CTC/Arena',
        metadata: {
          place: {
            id: 'gtfs/stop',
            transitStop: { feedOnestopId: 'f', stopId: 's' },
            geometry: { value: { center: { lat: 35.2, lng: -80.8 } } },
          } as any,
        },
      })],
    })).toEqual({
      name: 'place-location',
      params: { name: 'CTC/Arena', lat: '35.2', lng: '-80.8' },
      query: { complex: '1' },
    })
  })

  it('asks a question when Ask is offered', () => {
    const response = {
      query: 'quiet cafe for a date',
      intent: { intent: 'ask' as const, residual: 'quiet cafe for a date' },
      results: [],
    }
    expect(searchMatchRoute(response, { offerAsk: true }))
      .toEqual({ name: 'ask', query: { q: 'quiet cafe for a date' } })
    expect(searchMatchRoute(response)).toBeNull()
  })

  it('lists results without a match', () => {
    expect(searchMatchRoute({ results: [result({ id: 'node/1', type: 'place' })] })).toBeNull()
    expect(searchMatchRoute({ match: 'gone', results: [] })).toBeNull()
  })
})
