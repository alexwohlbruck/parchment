import { SOURCE, type Source } from '../constants'

export const MATCHED_PROVIDERS: Source[] = [SOURCE.GOOGLE, SOURCE.FOURSQUARE]

export type ProviderIds = Partial<Record<Source, string>>

export interface MatchUpdate {
  upserts: ProviderIds
  removals: Source[]
}

/** Provider ids the enriched place carries that the place didn't have from its own source. */
export function matchedProviderIds(
  source: Source,
  baseIds: Record<string, string>,
  enrichedIds: Record<string, string>,
): ProviderIds {
  const matched: ProviderIds = {}
  for (const provider of MATCHED_PROVIDERS) {
    const id = enrichedIds[provider]
    if (provider === source || !id || baseIds[provider] === id) continue
    matched[provider] = id
  }
  return matched
}

/** Writes that bring the stored matches in line with what this lookup found. */
export function planMatchUpdate(
  stored: ProviderIds,
  found: ProviderIds,
  stale: Source[],
): MatchUpdate {
  const upserts: ProviderIds = {}
  for (const [provider, id] of Object.entries(found) as [Source, string][]) {
    if (stored[provider] !== id) upserts[provider] = id
  }
  const removals = stale.filter((provider) => !found[provider])
  return { upserts, removals }
}
