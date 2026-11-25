import * as turf from '@turf/turf'
import { SOURCE, type Source } from '../../lib/constants'
import { AUTO_MATCHED_PROVIDERS, type ProviderMatch } from '../../lib/place/provider-matches'
import type { Language } from '../../lib/i18n/i18n.types'
import type { Place } from '../../types/place.types'
import type { ListingSummary, ProviderListing } from '../../types/place-listing.types'
import type { Stay } from '../../types/integration.types'
import { IntegrationCapabilityId } from '../../types/integration.enums'
import { integrationManager } from '../integrations'
import { lookupPlaceById, lookupPlacesByNameAndLocation } from '../place.service'
import { getProviderMatches, setProviderMatch } from './provider-matches.service'
import { LISTED_VENUE_PROVIDERS, isVenueProvider, venuePageUrl } from '../../lib/place/booking-venues'
import { bookingKind } from '../../lib/place/booking-kind'
import { HOTEL_SEARCH_RADIUS_M, hotelQueryScore, metresBetween, type HotelCandidate } from '../../lib/place/hotel-match'
import {
  GOOGLE_HOTELS_PROVIDER,
  LITEAPI_PROVIDER,
  hotelPricesCapability,
  hotelRatesCapability,
  forgetStayOffers,
  searchGoogleHotels,
} from '../stay.service'

const CANDIDATE_RADIUS_M = 500
const MAX_HOTEL_CANDIDATES = 20

function summarizeHotel(hotel: HotelCandidate, origin?: { lat: number; lng: number }): ListingSummary {
  const located = Number.isFinite(hotel.lat) && Number.isFinite(hotel.lng)
  return {
    id: hotel.id,
    name: hotel.name,
    address: hotel.address ?? null,
    distance: origin && located ? Math.round(metresBetween(origin, hotel)) : null,
  }
}

/** Providers this place can be matched at beyond the auto-matched ones: its hotel rates and booking sites. */
function bookingProviders(place: Place | null): string[] {
  const kind = bookingKind(place?.tags)
  if (!kind) return []
  const prices = kind === 'stay' && hotelPricesCapability() ? [GOOGLE_HOTELS_PROVIDER] : []
  const rates = kind === 'stay' && hotelRatesCapability() ? [LITEAPI_PROVIDER] : []
  return [...prices, ...rates, ...LISTED_VENUE_PROVIDERS[kind]]
}

async function storedSummary(
  provider: string,
  id: string,
  center: { lat: number; lng: number } | undefined,
  options: { language?: Language },
): Promise<ListingSummary | null> {
  if (isVenueProvider(provider)) {
    return { id, name: null, address: null, distance: null, url: venuePageUrl(provider, id) }
  }
  if (provider === LITEAPI_PROVIDER) {
    const hotel = await hotelRatesCapability()?.getHotel(id).catch(() => null)
    return hotel ? summarizeHotel(hotel, center) : null
  }
  const found = hasCapability(provider, IntegrationCapabilityId.PLACE_INFO)
    ? await lookupPlaceById(provider as Source, id, options).catch(() => null)
    : null
  return found ? summarize(found, center) : null
}

function isSearchable(provider: string): boolean {
  if (provider === GOOGLE_HOTELS_PROVIDER) return !!hotelPricesCapability()
  if (provider === LITEAPI_PROVIDER) return !!hotelRatesCapability()
  return hasCapability(provider, IntegrationCapabilityId.SEARCH)
}

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
    ...bookingProviders(place),
    ...Object.keys(stored),
  ])
  return Promise.all(
    [...providers].map(async (provider): Promise<ProviderListing> => {
      const match: ProviderMatch | undefined = stored[provider]
      const id = match?.providerPlaceId
      let listing: ListingSummary | null = null
      if (id) {
        listing = (await storedSummary(provider, id, center, options)) ?? { id, name: null, address: null, distance: null }
      }
      return {
        provider,
        listing,
        confirmed: match?.confirmed ?? false,
        searchable: isSearchable(provider),
        acceptsUrl: isVenueProvider(provider),
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
  if (provider === LITEAPI_PROVIDER) return searchHotelCandidates(center, query)
  if (provider === GOOGLE_HOTELS_PROVIDER) return searchGoogleHotelCandidates(center, query, place?.address?.value?.locality)
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

/** LiteAPI hotels near the place, closest name first, then nearest. */
async function searchHotelCandidates(center: { lat: number; lng: number }, query: string): Promise<ListingSummary[]> {
  const rates = hotelRatesCapability()
  if (!rates) return []
  const named = await rates.findHotels(center, HOTEL_SEARCH_RADIUS_M, query)
  const hotels = named.length ? named : await rates.findHotels(center, HOTEL_SEARCH_RADIUS_M)
  return hotels
    .map((hotel) => ({ hotel, similarity: hotelQueryScore(hotel.name, query) }))
    .sort((a, b) => b.similarity - a.similarity || metresBetween(center, a.hotel) - metresBetween(center, b.hotel))
    .slice(0, MAX_HOTEL_CANDIDATES)
    .map(({ hotel }) => summarizeHotel(hotel, center))
}

/** One night from tonight, for a Google Hotels search that needs dates to run. */
function tonight(): Stay {
  const checkin = new Date()
  const checkout = new Date(checkin.getTime() + 24 * 60 * 60 * 1000)
  const day = (d: Date) => d.toISOString().slice(0, 10)
  return { checkin: day(checkin), checkout: day(checkout), adults: 2, currency: 'USD', guestNationality: 'US' }
}

/** Google Hotels listings for the query in the place's town, within the search radius, nearest first. */
async function searchGoogleHotelCandidates(
  center: { lat: number; lng: number },
  query: string,
  locality: string | undefined,
): Promise<ListingSummary[]> {
  const hotels = await searchGoogleHotels([query, locality].filter(Boolean).join(', '), tonight())
  return hotels
    .map((hotel) => summarizeHotel(hotel, center))
    .filter((summary) => summary.distance === null || summary.distance <= HOTEL_SEARCH_RADIUS_M)
    .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity))
    .slice(0, MAX_HOTEL_CANDIDATES)
}

/** A person's correction: this listing, or `null` for none. Automatic matching won't override it. */
export async function correctListing(
  source: Source,
  placeId: string,
  provider: string,
  providerPlaceId: string | null,
): Promise<boolean> {
  const stored = await setProviderMatch(source, placeId, provider, { providerPlaceId, confirmed: true })
  forgetStayOffers(source, placeId)
  return stored
}
