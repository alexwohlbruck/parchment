import { SOURCE, type Source } from '../constants'

/** Providers whose listing an opened place is matched to automatically. The match store accepts any provider key. */
export const AUTO_MATCHED_PROVIDERS: Source[] = [SOURCE.GOOGLE, SOURCE.FOURSQUARE]

export interface ProviderMatch {
  /** Null records that the place has no listing at this provider. */
  providerPlaceId: string | null
  /** A person chose this match; automatic matching leaves it alone. */
  confirmed: boolean
}

/** Stored matches for one place, keyed by provider. */
export type ProviderMatches = Record<string, ProviderMatch>

export type ProviderIds = Record<string, string>

export interface MatchUpdate {
  upserts: ProviderIds
  removals: string[]
}

export interface MatchStoreRef {
  osmType: 'node' | 'way' | 'relation'
  osmId: string
}

/** Where a place's matches are kept, or null for places the store can't key (non-OSM, intersections). */
export function matchStoreRef(source: Source, id: string): MatchStoreRef | null {
  if (source !== SOURCE.OSM) return null
  const match = /^(node|way|relation)\/([1-9]\d*)$/.exec(id)
  return match ? { osmType: match[1] as MatchStoreRef['osmType'], osmId: match[2] } : null
}

/** Auto-matched listings to fetch directly instead of searching for them. */
export function storedListingIds(stored: ProviderMatches): ProviderIds {
  const ids: ProviderIds = {}
  for (const provider of AUTO_MATCHED_PROVIDERS) {
    const id = stored[provider]?.providerPlaceId
    if (id) ids[provider] = id
  }
  return ids
}

/** Providers a person said have no listing for this place, so they are never searched. */
export function clearedProviders(stored: ProviderMatches): string[] {
  return Object.entries(stored)
    .filter(([, match]) => match.confirmed && match.providerPlaceId === null)
    .map(([provider]) => provider)
}

/** Provider ids the enriched place carries that the place didn't have from its own source. */
export function matchedProviderIds(
  source: Source,
  baseIds: Record<string, string>,
  enrichedIds: Record<string, string>,
): ProviderIds {
  const matched: ProviderIds = {}
  for (const provider of AUTO_MATCHED_PROVIDERS) {
    const id = enrichedIds[provider]
    if (provider === source || !id || baseIds[provider] === id) continue
    matched[provider] = id
  }
  return matched
}

/** Writes that bring the stored matches in line with what this lookup found, never overriding a person's choice. */
export function planMatchUpdate(
  stored: ProviderMatches,
  found: ProviderIds,
  stale: string[],
): MatchUpdate {
  const upserts: ProviderIds = {}
  for (const [provider, id] of Object.entries(found)) {
    const current = stored[provider]
    if (current?.confirmed && !stale.includes(provider)) continue
    if (current?.providerPlaceId !== id) upserts[provider] = id
  }
  const removals = stale.filter((provider) => !found[provider])
  return { upserts, removals }
}
