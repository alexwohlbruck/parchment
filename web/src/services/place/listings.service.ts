import { api } from '@/lib/api'
import type {
  ListingSummary,
  ProviderListing,
} from '@server/types/place-listing.types'

export type { ListingSummary, ProviderListing }

const OSM = 'osm'

export async function fetchPlaceListings(id: string): Promise<ProviderListing[]> {
  const { data } = await api.get<{ listings: ProviderListing[] }>('/places/listings', {
    params: { source: OSM, id },
  })
  return data.listings
}

export async function fetchListingCandidates(
  id: string,
  provider: string,
  q?: string,
): Promise<ListingSummary[]> {
  const { data } = await api.get<{ candidates: ListingSummary[] }>('/places/listings/candidates', {
    params: { source: OSM, id, provider, q: q || undefined },
  })
  return data.candidates
}

export async function correctListing(
  id: string,
  provider: string,
  providerPlaceId: string | null,
): Promise<void> {
  await api.put('/places/listings', { source: OSM, id, provider, providerPlaceId })
}
