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
    (body?.matches ?? []).map(({ provider, providerPlaceId, confirmed }) => [provider, { providerPlaceId, confirmed }]),
  )
}

/** The id of this place's listing at any provider, or null when none is stored or the place has none there. */
export async function getProviderMatch(source: Source, placeId: string, provider: string): Promise<string | null> {
  return (await getProviderMatches(source, placeId))[provider]?.providerPlaceId ?? null
}

/** Record a place's listing at a provider, or `providerPlaceId: null` for none. Returns false for places the store can't key. */
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
