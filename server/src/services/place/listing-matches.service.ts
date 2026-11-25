import * as turf from '@turf/turf'
import { SOURCE, type Source } from '../../lib/constants'
import { AUTO_MATCHED_PROVIDERS, type ProviderMatch } from '../../lib/place/provider-matches'
import type { Language } from '../../lib/i18n/i18n.types'
import type { Place } from '../../types/place.types'
import type { ListingSummary, ProviderListing } from '../../types/place-listing.types'
import { IntegrationCapabilityId } from '../../types/integration.enums'
import { integrationManager } from '../integrations'
import { lookupPlaceById, lookupPlacesByNameAndLocation } from '../place.service'
import { getProviderMatches, setProviderMatch } from './provider-matches.service'

const CANDIDATE_RADIUS_M = 500

function summarize(candidate: Place, origin?: { lat: number; lng: number }): ListingSummary | null {
  const provider = candidate.sources?.[0]?.id
  const id = provider ? candidate.externalIds?.[provider] : undefined
  if (!id) return null
  const address = candidate.address?.value
  const center = candidate.geometry?.value?.center
  return {
    id,
    name: candidate.name?.value ?? null,
    address: address?.formatted ?? ([address?.street1, address?.locality].filter(Boolean).join(', ') || null),
    distance:
      origin && center
        ? Math.round(turf.distance([origin.lng, origin.lat], [center.lng, center.lat], { units: 'meters' }))
        : null,
  }
}

function hasCapability(provider: string, capability: IntegrationCapabilityId): boolean {
  return Boolean(integrationManager.getConfiguredIntegrationForSource(provider as Source, capability))
}

/**
 * Every provider a place can be matched at: the auto-matched ones that are
 * configured, plus any provider that already has a stored match.
 */
export async function getPlaceListings(
  source: Source,
  placeId: string,
  options: { language?: Language } = {},
): Promise<ProviderListing[]> {
  const [place, stored] = await Promise.all([
    lookupPlaceById(source, placeId, options),
    getProviderMatches(source, placeId),
  ])
  const center = place?.geometry?.value?.center
  const providers = new Set<string>([
    ...AUTO_MATCHED_PROVIDERS.filter((p) => hasCapability(p, IntegrationCapabilityId.PLACE_INFO)),
    ...Object.keys(stored),
  ])
  return Promise.all(
    [...providers].map(async (provider): Promise<ProviderListing> => {
      const match: ProviderMatch | undefined = stored[provider]
      const id = match?.providerPlaceId
      let listing: ListingSummary | null = null
      if (id) {
        const found = hasCapability(provider, IntegrationCapabilityId.PLACE_INFO)
          ? await lookupPlaceById(provider as Source, id, options).catch(() => null)
          : null
        listing = (found && summarize(found, center)) ?? { id, name: null, address: null, distance: null }
      }
      return {
        provider,
        listing,
        confirmed: match?.confirmed ?? false,
        searchable: hasCapability(provider, IntegrationCapabilityId.SEARCH),
      }
    }),
  )
}

/** Listings near the place at one provider, nearest first. */
export async function searchListingCandidates(
  source: Source,
  placeId: string,
  provider: string,
  options: { query?: string; language?: Language } = {},
): Promise<ListingSummary[]> {
  const place = await lookupPlaceById(source, placeId, { language: options.language })
  const center = place?.geometry?.value?.center
  const query = options.query?.trim() || place?.name?.value
  if (!center || !query) return []
  const otherSources = Object.values(SOURCE).filter((s) => s !== provider) as Source[]
  const found = await lookupPlacesByNameAndLocation(query, center, {
    radius: CANDIDATE_RADIUS_M,
    sourceBlacklist: otherSources,
    language: options.language,
  })
  const seen = new Set<string>()
  return found
    .filter((candidate) => candidate.sources?.[0]?.id === provider)
    .map((candidate) => summarize(candidate, center))
    .filter((summary): summary is ListingSummary => {
      if (!summary || seen.has(summary.id)) return false
      seen.add(summary.id)
      return true
    })
    .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity))
}

/** A person's correction: this listing, or `null` for none. Automatic matching won't override it. */
export function correctListing(
  source: Source,
  placeId: string,
  provider: string,
  providerPlaceId: string | null,
): Promise<boolean> {
  return setProviderMatch(source, placeId, provider, { providerPlaceId, confirmed: true })
}
