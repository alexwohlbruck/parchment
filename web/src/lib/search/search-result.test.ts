import { describe, it, expect, vi } from 'vitest'

vi.mock('@/router', () => ({ AppRoute: { SEARCH_RESULTS: 'search-results' } }))

const { createSearchResultsRoute } = await import('./search-result')

describe('createSearchResultsRoute', () => {
  it('browses a category, leaving out what the caller did not know', () => {
    expect(createSearchResultsRoute({
      categoryId: 'group/restrooms',
      categoryName: 'Restrooms',
      categoryIconCategory: undefined,
    })).toEqual({
      name: 'search-results',
      query: { categoryId: 'group/restrooms', categoryName: 'Restrooms' },
    })
  })

  it('starts the results with the given filters applied', () => {
    expect(createSearchResultsRoute({
      categoryId: 'amenity/cafe',
      filters: { openNow: '1', 'tag:outdoor_seating': 'yes' },
    }).query).toEqual({
      categoryId: 'amenity/cafe',
      'f.openNow': '1',
      'f.tag:outdoor_seating': 'yes',
    })
  })
})
