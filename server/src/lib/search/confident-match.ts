import type { SearchResult } from '../../types/search.types'

/** Lowercase, drop apostrophes, collapse everything else to single spaces. */
export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
}

export interface ScoredResult {
  result: SearchResult
  relevance: number
}

const MIN_QUERY_LENGTH = 3
/** A category this relevant means the query names a kind of place: "coffee", "library". */
const CATEGORY_TERM_RELEVANCE = 0.8

/**
 * The one place a full search means, when it means exactly one: a typed
 * coordinate, or the only place named exactly what was typed, ranked first.
 * A query naming a brand or a kind of place wants a list instead.
 */
export function confidentMatch(
  query: string,
  scored: ScoredResult[],
): string | undefined {
  const results = scored.map(s => s.result)
  const top = results[0]
  if (top?.id.startsWith('coords/')) return top.id

  const typed = normalizeName(query)
  if (typed.length < MIN_QUERY_LENGTH) return undefined

  const namedAsTyped = (r: SearchResult) => normalizeName(r.title) === typed
  const namesKind = scored.some(({ result, relevance }) =>
    (result.type === 'brand' && namedAsTyped(result)) ||
    (result.type === 'category' && relevance >= CATEGORY_TERM_RELEVANCE))
  if (namesKind) return undefined

  const places = results.filter(r => r.type === 'place')
  const named = places.filter(namedAsTyped)
  return named.length === 1 && named[0] === places[0] ? named[0].id : undefined
}
