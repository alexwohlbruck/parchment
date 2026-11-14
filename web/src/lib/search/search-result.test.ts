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
})
