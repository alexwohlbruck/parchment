import { integrationManager } from './integrations'
import { LiteApiIntegration } from './integrations/liteapi-integration'
import { IntegrationCapabilityId, IntegrationId } from '../types/integration.enums'
import type { Source } from '../lib/constants'
import { pickHotelMatch, HOTEL_SEARCH_RADIUS_M } from '../lib/place/hotel-match'
import { logWarn } from '../lib/logger'
import { lookupPlaceById } from './place.service'
import { getProviderMatches, setProviderMatch } from './place/provider-matches.service'
import type {
  HotelRatesCapability,
  StayRates,
  StayRatesRequest,
} from '../types/integration.types'

export type Stay = Omit<StayRatesRequest, 'hotelId'>

/** The provider key LiteAPI hotel ids are stored under in the match store. */
export const LITEAPI_PROVIDER = IntegrationId.LITEAPI

const CACHE_TTL_MS = 10 * 60 * 1000
const CACHE_LIMIT = 500

let envRates: HotelRatesCapability | null | undefined

/** A deployment can supply LiteAPI through `LITEAPI_API_KEY` and `LITEAPI_WHITELABEL_URL` instead of Settings. */
function ratesFromEnv(): HotelRatesCapability | null {
  if (envRates !== undefined) return envRates
  const apiKey = process.env.LITEAPI_API_KEY?.trim()
  const whitelabelUrl = process.env.LITEAPI_WHITELABEL_URL?.trim()
  if (!apiKey || !whitelabelUrl) return (envRates = null)
  const integration = new LiteApiIntegration()
  integration.initialize({ apiKey, whitelabelUrl })
  return (envRates = integration.capabilities.hotelRates!)
}

/** The configured hotel rates provider, from Settings first and the environment second. */
export function hotelRatesCapability(): HotelRatesCapability | null {
  for (const record of integrationManager.getConfiguredIntegrationsByCapability(
    IntegrationCapabilityId.HOTEL_RATES,
  )) {
    const capability = integrationManager.getCachedIntegrationInstance(record)?.capabilities.hotelRates
    if (capability) return capability
  }
  return ratesFromEnv()
}

const matching = new Map<string, Promise<string | null>>()

/**
 * Finds the place's hotel near it and saves the result, a miss as null, unconfirmed,
 * so a person can still correct it. A match that fails to save is still used.
 */
async function matchHotel(source: Source, placeId: string, capability: HotelRatesCapability): Promise<string | null> {
  const place = await lookupPlaceById(source, placeId)
  const name = place?.name?.value
  const center = place?.geometry?.value?.center
  if (!name || !center) return null
  const candidates = await capability.findHotels(center, HOTEL_SEARCH_RADIUS_M)
  const hotelId = pickHotelMatch(candidates, { name, ...center })?.id ?? null
  await setProviderMatch(source, placeId, LITEAPI_PROVIDER, { providerPlaceId: hotelId, confirmed: false }).catch(
    (error) => logWarn('Could not save LiteAPI match', error),
  )
  return hotelId
}

/** The LiteAPI hotel at a place: its stored match, or a lookup made once and then stored. Null means none. */
export async function liteApiHotelId(
  source: Source,
  placeId: string,
  capability: HotelRatesCapability,
): Promise<string | null> {
  const stored = (await getProviderMatches(source, placeId))[LITEAPI_PROVIDER]
  if (stored) return stored.providerPlaceId

  const key = `${source}:${placeId}`
  let pending = matching.get(key)
  if (!pending) {
    pending = matchHotel(source, placeId, capability).finally(() => matching.delete(key))
    matching.set(key, pending)
  }
  return pending
}

const cache = new Map<string, { rates: StayRates; at: number }>()

function cacheKey(request: StayRatesRequest): string {
  return [
    request.hotelId,
    request.checkin,
    request.checkout,
    request.adults,
    request.currency,
    request.guestNationality,
  ].join('|')
}

function remember(key: string, rates: StayRates): void {
  if (cache.size >= CACHE_LIMIT) {
    const now = Date.now()
    for (const [k, v] of cache) if (now - v.at > CACHE_TTL_MS) cache.delete(k)
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!)
  }
  cache.set(key, { rates, at: Date.now() })
}

/**
 * Live rooms for the hotel at a place. Null when no rates provider is set up
 * or the place has no matched listing, so the client falls back to its search links.
 */
export async function getStayRates(source: Source, placeId: string, stay: Stay): Promise<StayRates | null> {
  const capability = hotelRatesCapability()
  if (!capability) return null
  const hotelId = await liteApiHotelId(source, placeId, capability)
  if (!hotelId) return null
  const request: StayRatesRequest = { ...stay, hotelId }

  const key = cacheKey(request)
  const cached = cache.get(key)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.rates

  const rates = await capability.getStayRates(request)
  remember(key, rates)
  return rates
}

export function resetStayRatesForTests(): void {
  cache.clear()
  matching.clear()
  envRates = undefined
}
