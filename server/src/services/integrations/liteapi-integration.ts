import type {
  HotelCandidate,
  HotelRatesCapability,
  Integration,
  IntegrationCapabilities,
  IntegrationConfig,
  IntegrationTestResult,
  StayRates,
  StayRatesRequest,
} from '../../types/integration.types'
import { IntegrationCapabilityId, IntegrationId } from '../../types/integration.enums'
import {
  adaptLiteApiHotel,
  adaptLiteApiHotelDetail,
  adaptLiteApiRooms,
  liteApiCheckoutUrl,
  liteApiHotelUrl,
  type LiteApiHotel,
  type LiteApiHotelDetail,
  type LiteApiRoomType,
} from './adapters/liteapi-adapter'

export interface LiteApiConfig extends IntegrationConfig {
  apiKey: string
  /** The account's white-label booking site, where every checkout happens. */
  whitelabelUrl: string
}

export const LITEAPI_BASE = 'https://api.liteapi.travel/v3.0'

const RATES_TIMEOUT_SECONDS = 8
const MIN_SEARCH_RADIUS_M = 1000

/**
 * LiteAPI (Nuitée): live room rates from one API across its suppliers. The
 * key decides sandbox or production. Checkout runs on the account's
 * white-label site, which takes payment and is the merchant of record.
 */
export class LiteApiIntegration implements Integration<LiteApiConfig> {
  readonly integrationId = IntegrationId.LITEAPI
  readonly capabilityIds = [IntegrationCapabilityId.HOTEL_RATES]

  private config: LiteApiConfig | null = null

  readonly capabilities: IntegrationCapabilities = {
    hotelRates: {
      getStayRates: this.getStayRates.bind(this),
      findHotels: this.findHotels.bind(this),
      getHotel: this.getHotel.bind(this),
    } satisfies HotelRatesCapability,
  }

  validateConfig(config: LiteApiConfig): boolean {
    if (!config?.apiKey?.trim() || !config?.whitelabelUrl?.trim()) return false
    try {
      return new URL(config.whitelabelUrl).protocol === 'https:'
    } catch {
      return false
    }
  }

  initialize(config: LiteApiConfig): void {
    if (!this.validateConfig(config)) {
      throw new Error('Invalid configuration: API key and an https white-label URL are required')
    }
    this.config = { apiKey: config.apiKey.trim(), whitelabelUrl: config.whitelabelUrl.trim() }
  }

  async testConnection(config: LiteApiConfig): Promise<IntegrationTestResult> {
    if (!this.validateConfig(config)) {
      return { success: false, message: 'API key and an https white-label URL are required' }
    }
    try {
      const res = await fetch(`${LITEAPI_BASE}/data/currencies`, {
        headers: { 'X-API-Key': config.apiKey.trim() },
        signal: AbortSignal.timeout(8_000),
      })
      if (res.status === 401 || res.status === 403) return { success: false, message: 'Invalid API key' }
      if (!res.ok) return { success: false, message: `LiteAPI error: ${res.status}` }
      return { success: true }
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Failed to reach LiteAPI' }
    }
  }

  private async request<T>(path: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<T> {
    if (!this.config) throw new Error('LiteAPI is not configured')
    const res = await fetch(`${LITEAPI_BASE}${path}`, {
      ...init,
      headers: {
        'X-API-Key': this.config.apiKey,
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) throw new Error(`LiteAPI ${path}: ${res.status}`)
    return (await res.json()) as T
  }

  private async findHotels(center: { lat: number; lng: number }, radius: number, name?: string): Promise<HotelCandidate[]> {
    const params = new URLSearchParams({
      latitude: String(center.lat),
      longitude: String(center.lng),
      radius: String(Math.max(radius, MIN_SEARCH_RADIUS_M)),
      limit: '50',
      ...(name?.trim() && { hotelName: name.trim() }),
    })
    const { data = [] } = await this.request<{ data?: LiteApiHotel[] }>(`/data/hotels?${params}`)
    return data.map(adaptLiteApiHotel)
  }

  private async getHotel(hotelId: string): Promise<HotelCandidate | null> {
    try {
      const { data } = await this.request<{ data?: LiteApiHotelDetail }>(
        `/data/hotel?${new URLSearchParams({ hotelId })}`,
      )
      return data ? adaptLiteApiHotelDetail(data) : null
    } catch (error) {
      if (error instanceof Error && /: (400|404)$/.test(error.message)) return null
      throw error
    }
  }

  private async getStayRates(request: StayRatesRequest): Promise<StayRates> {

    // A sold-out stay comes back as 200 with an error and no data.
    const { data } = await this.request<{ data?: { hotelId: string; roomTypes: LiteApiRoomType[] }[] }>(
      '/hotels/rates',
      {
        method: 'POST',
        body: JSON.stringify({
          hotelIds: [request.hotelId],
          occupancies: [{ adults: request.adults }],
          currency: request.currency,
          guestNationality: request.guestNationality,
          checkin: request.checkin,
          checkout: request.checkout,
          timeout: RATES_TIMEOUT_SECONDS,
        }),
      },
      (RATES_TIMEOUT_SECONDS + 4) * 1000,
    )

    const { whitelabelUrl } = this.config!
    const roomTypes = data?.find((entry) => entry.hotelId === request.hotelId)?.roomTypes ?? []
    return {
      provider: 'LiteAPI',
      hotelId: request.hotelId,
      rooms: adaptLiteApiRooms(roomTypes, (offerId) => liteApiCheckoutUrl(whitelabelUrl, offerId)),
      bookingUrl: liteApiHotelUrl(whitelabelUrl, request.hotelId, request),
    }
  }
}
