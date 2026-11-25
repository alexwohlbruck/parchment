import { integrationManager } from './integrations'
import { LiteApiIntegration } from './integrations/liteapi-integration'
import { SerpApiIntegration } from './integrations/serpapi-integration'
import { fixtureHotelPrices, stayPriceFixturesEnabled } from './integrations/fixtures/stay-price-fixtures'
import { IntegrationCapabilityId, IntegrationId } from '../types/integration.enums'
import type { Source } from '../lib/constants'
import { pickHotelMatch, HOTEL_SEARCH_RADIUS_M, type HotelCandidate } from '../lib/place/hotel-match'
import { cheapestRoomOffer, mergeOffers } from '../lib/place/stay-offers'
import { logWarn } from '../lib/logger'
import { lookupPlaceById } from './place.service'
import { getProviderMatches, setProviderMatch } from './place/provider-matches.service'
import { saveListingLabel } from './place/listing-labels.service'
import type {
  HotelPricesCapability,
  HotelRatesCapability,
  IntegrationCapabilities,
  Stay,
  StayOffer,
  StayOffers,
} from '../types/integration.types'
import type { Place } from '../types/place.types'

/** Match-store provider keys for a hotel's listing at each source. */
export const LITEAPI_PROVIDER = IntegrationId.LITEAPI
export const GOOGLE_HOTELS_PROVIDER = 'google_hotels'

/** Prices move slowly enough, and each Google Hotels check costs a search credit. */
const CACHE_TTL_MS = 30 * 60 * 1000
const CACHE_LIMIT = 500

const fromEnv = new Map<string, IntegrationCapabilities | null>()

/** A deployment can configure an integration through environment variables instead of Settings. */
function envCapabilities(key: string, build: () => IntegrationCapabilities | null): IntegrationCapabilities | null {
  if (!fromEnv.has(key)) fromEnv.set(key, build())
  return fromEnv.get(key)!
}

function configured<K extends keyof IntegrationCapabilities>(
  capabilityId: IntegrationCapabilityId,
  key: K,
): IntegrationCapabilities[K] | undefined {
  for (const record of integrationManager.getConfiguredIntegrationsByCapability(capabilityId)) {
    const capability = integrationManager.getCachedIntegrationInstance(record)?.capabilities[key]
    if (capability) return capability
  }
  return undefined
}

/** LiteAPI from Settings, else `LITEAPI_API_KEY` and `LITEAPI_WHITELABEL_URL`. */
export function hotelRatesCapability(): HotelRatesCapability | null {
  return (
    configured(IntegrationCapabilityId.HOTEL_RATES, 'hotelRates') ??
    envCapabilities('liteapi', () => {
      const apiKey = process.env.LITEAPI_API_KEY?.trim()
      const whitelabelUrl = process.env.LITEAPI_WHITELABEL_URL?.trim()
      if (!apiKey || !whitelabelUrl) return null
      const integration = new LiteApiIntegration()
      integration.initialize({ apiKey, whitelabelUrl })
      return integration.capabilities
    })?.hotelRates ??
    null
  )
}

/** SerpApi from Settings, else `SERPAPI_API_KEY`, else recorded prices in development with `STAY_PRICE_FIXTURES=1`. */
export function hotelPricesCapability(): HotelPricesCapability | null {
  if (stayPriceFixturesEnabled()) return fixtureHotelPrices
  return (
    configured(IntegrationCapabilityId.HOTEL_PRICES, 'hotelPrices') ??
    envCapabilities('serpapi', () => {
      const apiKey = process.env.SERPAPI_API_KEY?.trim()
      if (!apiKey) return null
      const integration = new SerpApiIntegration()
      integration.initialize({ apiKey })
      return integration.capabilities
    })?.hotelPrices ??
    null
  )
}

const matching = new Map<string, Promise<string | null>>()

/**
 * The place's listing at a provider: the stored match, or a lookup made once
 * and stored unconfirmed, a miss as null, so a person can still correct it.
 * A stored null is never searched again. A match that fails to save is still used.
 */
async function storedOrMatched(
  source: Source,
  placeId: string,
  provider: string,
  find: (place: Place) => Promise<string | null>,
): Promise<string | null> {
  const stored = (await getProviderMatches(source, placeId))[provider]
  if (stored) return stored.providerPlaceId

  const key = `${provider}:${source}:${placeId}`
  let pending = matching.get(key)
  if (!pending) {
    pending = (async () => {
      const place = await lookupPlaceById(source, placeId)
      if (!place?.name?.value || !place.geometry?.value?.center) return null
      const id = await find(place)
      await setProviderMatch(source, placeId, provider, { providerPlaceId: id, confirmed: false }).catch((error) =>
        logWarn(`Could not save ${provider} match`, error),
      )
      return id
    })().finally(() => matching.delete(key))
    matching.set(key, pending)
  }
  return pending
}

function target(place: Place): { name: string; lat: number; lng: number } {
  return { name: place.name!.value!, ...place.geometry.value.center }
}

const SEEN_HOTELS_LIMIT = 500
const seenGoogleHotels = new Map<string, HotelCandidate>()

/** Hotels a Google Hotels search returned, so a pick from them can be named without a paid lookup. */
function rememberGoogleHotels(candidates: HotelCandidate[]): void {
  for (const candidate of candidates) {
    seenGoogleHotels.delete(candidate.id)
    seenGoogleHotels.set(candidate.id, candidate)
  }
  while (seenGoogleHotels.size > SEEN_HOTELS_LIMIT) seenGoogleHotels.delete(seenGoogleHotels.keys().next().value!)
}

/** Stores the name of a Google Hotels listing a search returned, since its token can't be looked up for free. */
export async function labelGoogleHotel(token: string): Promise<void> {
  const hotel = seenGoogleHotels.get(token)
  if (!hotel) return
  await saveListingLabel(GOOGLE_HOTELS_PROVIDER, token, { name: hotel.name, address: hotel.address ?? null }).catch(
    (error) => logWarn('Could not save Google Hotels label', error),
  )
}

/** Google Hotels resolves a query naming one hotel straight to it; its prices then come free with the match. */
const resolvedOffers = new Map<string, StayOffer[]>()

function googleHotelsQuery(place: Place): string {
  return [place.name?.value, place.address?.value?.locality].filter(Boolean).join(', ')
}

async function googleOffers(source: Source, placeId: string, stay: Stay, prices: HotelPricesCapability) {
  const token = await storedOrMatched(source, placeId, GOOGLE_HOTELS_PROVIDER, async (place) => {
    const found = await prices.searchHotels(googleHotelsQuery(place), stay)
    rememberGoogleHotels(found.candidates)
    const match = pickHotelMatch(found.candidates, target(place))
    if (match && found.property?.candidate.id === match.id) resolvedOffers.set(match.id, found.property.offers)
    if (match) await labelGoogleHotel(match.id)
    return match?.id ?? null
  })
  if (!token) return null
  const resolved = resolvedOffers.get(token)
  resolvedOffers.delete(token)
  return resolved ?? (await prices.getOffers(token, stay))
}

async function liteApiOffers(source: Source, placeId: string, stay: Stay, rates: HotelRatesCapability) {
  const hotelId = await storedOrMatched(source, placeId, LITEAPI_PROVIDER, async (place) => {
    const center = place.geometry.value.center
    const named = pickHotelMatch(await rates.findHotels(center, HOTEL_SEARCH_RADIUS_M, place.name!.value!), target(place))
    return (named ?? pickHotelMatch(await rates.findHotels(center, HOTEL_SEARCH_RADIUS_M), target(place)))?.id ?? null
  })
  if (!hotelId) return null
  const offer = cheapestRoomOffer(await rates.getStayRates({ ...stay, hotelId }), stay)
  return offer ? [offer] : []
}

const cache = new Map<string, { offers: StayOffers | null; at: number }>()

function remember(key: string, offers: StayOffers | null): void {
  if (cache.size >= CACHE_LIMIT) {
    const now = Date.now()
    for (const [k, v] of cache) if (now - v.at > CACHE_TTL_MS) cache.delete(k)
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!)
  }
  cache.set(key, { offers, at: Date.now() })
}

/** Hotels near a point at Google Hotels, for picking a place's listing by hand. */
export async function searchGoogleHotels(query: string, stay: Stay): Promise<HotelCandidate[]> {
  const candidates = (await hotelPricesCapability()?.searchHotels(query, stay))?.candidates ?? []
  rememberGoogleHotels(candidates)
  return candidates
}

/**
 * Every seller's price for the hotel at a place: Google Hotels sellers and
 * our booking partner. Null when no source is configured or none lists the
 * hotel, so the client falls back to its search links. One source failing
 * leaves the other's offers.
 */
export async function getStayOffers(source: Source, placeId: string, stay: Stay): Promise<StayOffers | null> {
  const prices = hotelPricesCapability()
  const rates = hotelRatesCapability()
  if (!prices && !rates) return null

  const key = [source, placeId, stay.checkin, stay.checkout, stay.adults, stay.currency, stay.guestNationality].join('|')
  const cached = cache.get(key)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.offers

  const settle = <T>(work: Promise<T>, label: string) =>
    work.catch((error) => {
      logWarn(`${label} prices failed`, error)
      return undefined
    })
  const [google, partner] = await Promise.all([
    prices ? settle(googleOffers(source, placeId, stay, prices), 'Google Hotels') : null,
    rates ? settle(liteApiOffers(source, placeId, stay, rates), 'LiteAPI') : null,
  ])
  const failed = [prices && google === undefined, rates && partner === undefined].filter(Boolean).length
  if (failed === [prices, rates].filter(Boolean).length) throw new Error('Hotel prices unavailable')

  const offers = !google && !partner ? null : { offers: mergeOffers(partner ?? [], google ?? []) }
  if (!failed) remember(key, offers)
  return offers
}

/** Drops a place's cached prices, after its listing is corrected. */
export function forgetStayOffers(source: Source, placeId: string): void {
  const prefix = `${source}|${placeId}|`
  for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key)
}

export function resetStayOffersForTests(): void {
  cache.clear()
  seenGoogleHotels.clear()
  matching.clear()
  resolvedOffers.clear()
  fromEnv.clear()
}
