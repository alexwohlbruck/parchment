import type { RouteLocationRaw } from 'vue-router'
import type { Place } from '@/types/place.types'
import type { SearchResponse } from '@/types/search.types'
import { AppRoute } from '@/router'
import { intentFilters } from '@/lib/search/query-intent'
import { createBrandResultsRoute, createSearchResultsRoute } from '@/lib/search/search-result'
import { getResultPlaceRoute } from '@/lib/place/place-route'

/**
 * Where a committed search opens instead of its results list: Ask for a
 * question, a filtered browse, the category or brand it names, or the one
 * place it means.
 */
export function searchMatchRoute(
  { query, results, match, intent }: Pick<SearchResponse, 'results' | 'match' | 'intent'> & { query?: string },
  { offerAsk = false } = {},
): RouteLocationRaw | null {
  if (intent?.intent === 'ask' && offerAsk && query) {
    return { name: AppRoute.ASK, query: { q: query } }
  }
  if (intent?.intent === 'browse' && intent.category) {
    return createSearchResultsRoute({
      categoryId: intent.category.id,
      categoryName: intent.category.name,
      filters: intentFilters(intent),
    })
  }

  const result = match ? results.find(r => r.id === match) : undefined
  if (!result) return null

  if (result.type === 'category') {
    return createSearchResultsRoute({
      categoryId: result.id,
      categoryName: result.title,
      categoryIconCategory: result.iconCategory,
    })
  }
  if (result.type === 'brand') {
    const brand = result.metadata.brand
    return createBrandResultsRoute(brand?.brandKey ?? result.id, brand?.name ?? result.title)
  }
  const place = result.metadata.place as unknown as Place | undefined
  return place ? getResultPlaceRoute(place, result.title) : null
}
