import type { QueryIntent } from '@/types/search.types'

export const LOOKUP_INTENT: QueryIntent = { intent: 'lookup', residual: '' }

/** The results filters, keyed like the URL's `f.` params, that a browse intent asks for. */
export function intentFilters(intent: QueryIntent): Record<string, string> {
  const filters: Record<string, string> = intent.openNow ? { openNow: '1' } : {}
  for (const [key, value] of Object.entries(intent.tags ?? {})) {
    filters[`tag:${key}`] = value
  }
  return filters
}
