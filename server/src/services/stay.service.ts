import { integrationManager } from './integrations'
import { LiteApiIntegration } from './integrations/liteapi-integration'
import { IntegrationCapabilityId } from '../types/integration.enums'
import { IntegrationId } from '../types/integration.enums'
import type {
  HotelRatesCapability,
  StayRates,
  StayRatesRequest,
} from '../types/integration.types'

export interface StayPlace {
  source: string
  id: string
}

export type Stay = Omit<StayRatesRequest, 'hotelId'>

/** Finds the provider's id for a place's listing. */
export type VenueIdLookup = (place: StayPlace, provider: IntegrationId) => Promise<string | null>

/**
 * Venue ids come from the provider match store (PAR-271, #1084). Until it
 * lands nothing resolves, so every place falls back to the search links.
 */
let lookupVenueId: VenueIdLookup = async () => null

export function setVenueIdLookup(lookup: VenueIdLookup): void {
  lookupVenueId = lookup
}

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

function configuredRates(): HotelRatesCapability | null {
  for (const record of integrationManager.getConfiguredIntegrationsByCapability(
    IntegrationCapabilityId.HOTEL_RATES,
  )) {
    const capability = integrationManager.getCachedIntegrationInstance(record)?.capabilities.hotelRates
    if (capability) return capability
  }
  return ratesFromEnv()
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
export async function getStayRates(place: StayPlace, stay: Stay): Promise<StayRates | null> {
  const capability = configuredRates()
  if (!capability) return null
  const hotelId = await lookupVenueId(place, IntegrationId.LITEAPI)
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
  envRates = undefined
  lookupVenueId = async () => null
}
