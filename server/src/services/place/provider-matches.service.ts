import type { Source } from '../../lib/constants'
import {
  matchStoreRef,
  type MatchStoreRef,
  type MatchUpdate,
  type ProviderMatch,
  type ProviderMatches,
} from '../../lib/place/provider-matches'
import { BarrelmanError, sendBarrelman } from '../barrelman.service'

const matchesPath = ({ osmType, osmId }: MatchStoreRef, provider?: string) =>
  `/place/${osmType}/${osmId}/matches${provider ? `/${encodeURIComponent(provider)}` : ''}`

/** The listings this place is matched to, by provider. Empty for places the store can't key. */
export async function getProviderMatches(source: Source, placeId: string): Promise<ProviderMatches> {
  const ref = matchStoreRef(source, placeId)
  if (!ref) return {}
  const body = await sendBarrelman<{ matches: (ProviderMatch & { provider: string })[] }>('GET', matchesPath(ref))
  return Object.fromEntries(
    (body?.matches ?? []).map(({ provider, providerPlaceId, confirmed, label }) => [
      provider,
      { providerPlaceId, confirmed, label: label ?? null },
    ]),
  )
}

/** This place's stored match at a provider (its listing id, or null for none, and display name), or null when nothing is stored. */
export async function getProviderMatch(source: Source, placeId: string, provider: string): Promise<ProviderMatch | null> {
  return (await getProviderMatches(source, placeId))[provider] ?? null
}

/**
 * Record a place's listing at a provider, or `providerPlaceId: null` for none,
 * with its display name when given. Returns false for places the store can't key.
 */
export async function setProviderMatch(
  source: Source,
  placeId: string,
  provider: string,
  match: ProviderMatch,
): Promise<boolean> {
  const ref = matchStoreRef(source, placeId)
  if (!ref) return false
  await sendBarrelman('PUT', matchesPath(ref, provider), match)
  return true
}

/** Forget a place's match at a provider, so the next lookup searches again. */
export async function deleteProviderMatch(source: Source, placeId: string, provider: string): Promise<void> {
  const ref = matchStoreRef(source, placeId)
  if (!ref) return
  try {
    await sendBarrelman('DELETE', matchesPath(ref, provider))
  } catch (error) {
    if (!(error instanceof BarrelmanError && error.status === 404)) throw error
  }
}

export async function applyProviderMatchUpdate(
  source: Source,
  placeId: string,
  { upserts, removals }: MatchUpdate,
): Promise<void> {
  await Promise.all([
    ...Object.entries(upserts).map(([provider, providerPlaceId]) =>
      setProviderMatch(source, placeId, provider, { providerPlaceId, confirmed: false }),
    ),
    ...removals.map((provider) => deleteProviderMatch(source, placeId, provider)),
  ])
}
