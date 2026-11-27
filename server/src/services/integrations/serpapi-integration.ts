import type {
  GoogleHotelsSearch,
  HotelCandidate,
  HotelPricesCapability,
  Integration,
  IntegrationCapabilities,
  IntegrationConfig,
  IntegrationTestResult,
  Stay,
  StayOffer,
} from '../../types/integration.types'
import { IntegrationCapabilityId, IntegrationId } from '../../types/integration.enums'
import {
  adaptSerpCandidate,
  adaptSerpOffers,
  type SerpHotelsResponse,
} from './adapters/serpapi-adapter'

export interface SerpApiConfig extends IntegrationConfig {
  apiKey: string
}

export const SERPAPI_SEARCH_URL = 'https://serpapi.com/search.json'

/** SerpApi answers an empty result with this error rather than an empty list. */
const NO_RESULTS = /hasn't returned any results/i

/**
 * SerpApi's Google Hotels engine: every seller's price for a hotel. Each
 * request is one search credit, so callers cache and store property tokens.
 */
export class SerpApiIntegration implements Integration<SerpApiConfig> {
  readonly integrationId = IntegrationId.SERPAPI
  readonly capabilityIds = [IntegrationCapabilityId.HOTEL_PRICES]

  private config: SerpApiConfig | null = null

  readonly capabilities: IntegrationCapabilities = {
    hotelPrices: {
      searchHotels: this.searchHotels.bind(this),
      getOffers: this.getOffers.bind(this),
    } satisfies HotelPricesCapability,
  }

  validateConfig(config: SerpApiConfig): boolean {
    return !!config?.apiKey?.trim()
  }

  initialize(config: SerpApiConfig): void {
    if (!this.validateConfig(config)) throw new Error('Invalid configuration: API key is required')
    this.config = { apiKey: config.apiKey.trim() }
  }

  async testConnection(config: SerpApiConfig): Promise<IntegrationTestResult> {
    if (!this.validateConfig(config)) return { success: false, message: 'API key is required' }
    try {
      const res = await fetch(`https://serpapi.com/account.json?${new URLSearchParams({ api_key: config.apiKey.trim() })}`, {
        signal: AbortSignal.timeout(8_000),
      })
      if (res.status === 401) return { success: false, message: 'Invalid API key' }
      if (!res.ok) return { success: false, message: `SerpApi error: ${res.status}` }
      return { success: true }
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Failed to reach SerpApi' }
    }
  }

  private async search(params: Record<string, string>, stay: Stay): Promise<SerpHotelsResponse | null> {
    if (!this.config) throw new Error('SerpApi is not configured')
    const query = new URLSearchParams({
      engine: 'google_hotels',
      check_in_date: stay.checkin,
      check_out_date: stay.checkout,
      adults: String(stay.adults),
      currency: stay.currency,
      gl: stay.guestNationality.toLowerCase(),
      hl: 'en',
      ...params,
      api_key: this.config.apiKey,
    })
    const res = await fetch(`${SERPAPI_SEARCH_URL}?${query}`, { signal: AbortSignal.timeout(20_000) })
    const body = (await res.json().catch(() => ({}))) as SerpHotelsResponse
    if (body.error && NO_RESULTS.test(body.error)) return null
    if (!res.ok || body.error) throw new Error(`SerpApi google_hotels: ${res.status} ${body.error ?? ''}`.trim())
    return body
  }

  private async searchHotels(q: string, stay: Stay): Promise<GoogleHotelsSearch> {
    const body = await this.search({ q }, stay)
    if (!body) return { candidates: [] }
    if (body.properties) {
      return {
        candidates: body.properties.map(adaptSerpCandidate).filter((c): c is HotelCandidate => !!c),
      }
    }
    const candidate = adaptSerpCandidate(body)
    if (!candidate) return { candidates: [] }
    return { candidates: [candidate], property: { candidate, offers: adaptSerpOffers(body, stay.currency) } }
  }

  private async getOffers(propertyToken: string, stay: Stay): Promise<StayOffer[]> {
    const body = await this.search({ property_token: propertyToken }, stay)
    return body ? adaptSerpOffers(body, stay.currency) : []
  }
}
