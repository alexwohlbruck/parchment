import type {
  Integration,
  IntegrationConfig,
  IntegrationTestResult,
  SearchCapability,
  PlaceInfoCapability,
} from '../../types/integration.types'
import {
  IntegrationCapabilityId,
  IntegrationId,
} from '../../types/integration.types'
import type { Place } from '../../types/place.types'
import { SOURCE } from '../../lib/constants'
import {
  FoursquareAdapter,
  type FoursquarePlace,
  type FoursquareTip,
} from './adapters/foursquare-adapter'

export interface FoursquareConfig extends IntegrationConfig {
  apiKey: string
}

/** Pinned Places API version — the header is required by the v2025 API. */
const PLACES_API_VERSION = '2025-06-17'

/**
 * Foursquare caches metadata for at most 24h (the `fsq_place_id` may be
 * stored indefinitely, which we handle separately by persisting the matched
 * id). We keep our in-process cache within that window.
 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const MAX_CACHE_ENTRIES = 500

/**
 * Lean fields for the search blend — coverage + identity only. Keeps search
 * calls on the cheaper Pro tier and avoids paying Premium rates across an
 * entire result list.
 */
const SEARCH_FIELDS =
  'fsq_place_id,name,latitude,longitude,location,categories,tel,website'

/**
 * Rich fields for a single opened place — the Premium tier (hours, rating,
 * photos, stats). Paid once per place-open, not per search result. Reviews
 * (tips) come from the dedicated `/tips` sub-endpoint, which supports richer
 * per-tip fields + sorting, so they're not requested inline here.
 */
const DETAIL_FIELDS =
  'fsq_place_id,name,latitude,longitude,location,categories,tel,website,email,social_media,hours,rating,price,photos,stats,attributes,popularity,hours_popular,menu,date_closed'

/** Per-tip fields for the reviews list (the sub-endpoint's rich shape). */
const TIP_FIELDS =
  'fsq_tip_id,created_at,text,lang,agree_count,disagree_count,url'

/** How many reviews (tips) to pull per place. */
const REVIEW_LIMIT = 12

interface CacheEntry {
  value: Place | Place[] | null
  cachedAt: number
}

/**
 * Foursquare Places integration (v2025 API).
 *
 * Two roles:
 *  - SEARCH   — blends global POI coverage into results, filling OSM gaps.
 *  - PLACE_INFO — enriches an opened place with photos, hours, ratings.
 *
 * Conflation for enrichment uses the Place Match endpoint (`matchPlace`),
 * which returns a single best `fsq_place_id` + confidence — the id we later
 * persist in Barrelman so users can correct a bad match.
 */
export class FoursquareIntegration
  implements Integration<FoursquareConfig>
{
  private config: FoursquareConfig = { apiKey: '' }
  private baseUrl = 'https://places-api.foursquare.com'
  private adapter = new FoursquareAdapter()
  private cache = new Map<string, CacheEntry>()

  readonly integrationId = IntegrationId.FOURSQUARE
  readonly sources = [SOURCE.FOURSQUARE]
  readonly capabilityIds: IntegrationCapabilityId[] = [
    IntegrationCapabilityId.SEARCH,
    IntegrationCapabilityId.PLACE_INFO,
  ]
  readonly capabilities = {
    search: {
      searchPlaces: this.searchPlaces.bind(this),
    } as SearchCapability,
    placeInfo: {
      getPlaceInfo: this.getPlaceInfo.bind(this),
    } as PlaceInfoCapability,
  }

  async testConnection(
    config: FoursquareConfig,
  ): Promise<IntegrationTestResult> {
    if (!this.validateConfig(config)) {
      return { success: false, message: 'API Key is required' }
    }
    try {
      const url = new URL(`${this.baseUrl}/places/search`)
      url.searchParams.set('query', 'coffee')
      url.searchParams.set('ll', '40.7128,-74.006')
      url.searchParams.set('limit', '1')
      const response = await fetch(url.toString(), {
        headers: this.headers(config.apiKey),
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) {
        return {
          success: false,
          message: `Foursquare API error: ${response.status}`,
        }
      }
      return { success: true }
    } catch (error: any) {
      console.error('Foursquare test connection error:', error)
      return {
        success: false,
        message: error?.message || 'Failed to connect to Foursquare',
      }
    }
  }

  initialize(config: FoursquareConfig): void {
    // Never log `config` — it holds the API key.
    this.config = config
  }

  validateConfig(config: FoursquareConfig): boolean {
    return !!config.apiKey
  }

  private headers(apiKey: string): Record<string, string> {
    return {
      Authorization: `Bearer ${apiKey}`,
      'X-Places-Api-Version': PLACES_API_VERSION,
      Accept: 'application/json',
    }
  }

  /**
   * Search Foursquare for POIs near a coordinate. Lean fields only — this
   * feeds the global search blend, not the premium detail view.
   */
  private async searchPlaces(
    query: string,
    lat?: number,
    lng?: number,
    options?: {
      radius?: number
      limit?: number
      signal?: AbortSignal
    },
  ): Promise<Place[]> {
    if (!this.config.apiKey) return []

    const radius = options?.radius ?? 22000
    const limit = Math.min(options?.limit ?? 20, 50)
    const cacheKey = `search:${query}:${lat ?? ''},${lng ?? ''}:${radius}:${limit}`
    const cached = this.readCache(cacheKey)
    if (cached !== undefined) return (cached as Place[]) ?? []

    try {
      const url = new URL(`${this.baseUrl}/places/search`)
      url.searchParams.set('query', query)
      if (lat !== undefined && lng !== undefined) {
        url.searchParams.set('ll', `${lat},${lng}`)
        url.searchParams.set('radius', String(radius))
      }
      url.searchParams.set('limit', String(limit))
      url.searchParams.set('fields', SEARCH_FIELDS)

      const response = await fetch(url.toString(), {
        headers: this.headers(this.config.apiKey),
        signal: options?.signal ?? AbortSignal.timeout(10_000),
      })
      if (!response.ok) {
        console.error(`Foursquare search HTTP error: ${response.status}`)
        return []
      }

      const data = await response.json()
      const results: FoursquarePlace[] = data?.results ?? []
      const places = results
        .filter((r) => r.fsq_place_id)
        .map((r) => this.adapter.adaptPlace(r))

      this.writeCache(cacheKey, places)
      return places
    } catch (error) {
      if (this.isAbort(error)) return []
      console.error('Foursquare search error:', error)
      return []
    }
  }

  /**
   * Fetch full Premium details for a known Foursquare place id. Accepts either
   * a bare `fsq_place_id` or a prefixed `foursquare/<id>` place id.
   */
  private async getPlaceInfo(id: string): Promise<Place | null> {
    if (!this.config.apiKey) return null

    const fsqId = id.startsWith(`${SOURCE.FOURSQUARE}/`)
      ? id.slice(SOURCE.FOURSQUARE.length + 1)
      : id

    const cacheKey = `details:${fsqId}`
    const cached = this.readCache(cacheKey)
    if (cached !== undefined) return (cached as Place) ?? null

    try {
      const url = new URL(`${this.baseUrl}/places/${encodeURIComponent(fsqId)}`)
      url.searchParams.set('fields', DETAIL_FIELDS)

      const response = await fetch(url.toString(), {
        headers: this.headers(this.config.apiKey),
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) {
        if (response.status !== 404) {
          console.error(`Foursquare details HTTP error: ${response.status}`)
        }
        return null
      }

      const data: FoursquarePlace = await response.json()
      if (!data?.fsq_place_id) return null

      const place = this.adapter.adaptPlace(data)
      const reviews = this.adapter.adaptReviews(await this.fetchTips(fsqId))
      if (reviews.length) place.reviews = reviews
      this.writeCache(cacheKey, place)
      return place
    } catch (error) {
      if (this.isAbort(error)) return null
      console.error('Foursquare details error:', error)
      return null
    }
  }

  /**
   * Fetch a place's tips (Foursquare's user reviews) from the dedicated
   * sub-endpoint, sorted by popularity. Failures degrade to an empty list so
   * a place still enriches with its other Premium data.
   */
  private async fetchTips(fsqId: string): Promise<FoursquareTip[]> {
    try {
      const url = new URL(
        `${this.baseUrl}/places/${encodeURIComponent(fsqId)}/tips`,
      )
      url.searchParams.set('limit', String(REVIEW_LIMIT))
      url.searchParams.set('sort', 'popular')
      url.searchParams.set('fields', TIP_FIELDS)

      const response = await fetch(url.toString(), {
        headers: this.headers(this.config.apiKey),
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) {
        if (response.status !== 404) {
          console.error(`Foursquare tips HTTP error: ${response.status}`)
        }
        return []
      }
      const data = await response.json()
      return Array.isArray(data) ? (data as FoursquareTip[]) : []
    } catch (error) {
      if (this.isAbort(error)) return []
      console.error('Foursquare tips error:', error)
      return []
    }
  }

  /**
   * Match a known place to its Foursquare twin via the Place Match endpoint.
   * The v2025 API requires structured `name` + `address` + `city` + `cc`
   * (country code) — so a match isn't possible without all of them, in which
   * case we return null and skip enrichment. Returns the single best
   * `fsq_place_id` (+ confidence if the API supplies one) — the id we later
   * store in Barrelman for user correction.
   */
  async matchPlace(
    name: string,
    location: { address?: string; city?: string; cc?: string },
    options?: { signal?: AbortSignal },
  ): Promise<{ fsqPlaceId: string; matchRate: number } | null> {
    if (!this.config.apiKey) return null
    const { address, city, cc } = location
    // The endpoint 400s without all three; bail cleanly rather than error.
    if (!name || !address || !city || !cc) return null

    try {
      const url = new URL(`${this.baseUrl}/places/match`)
      url.searchParams.set('name', name)
      url.searchParams.set('address', address)
      url.searchParams.set('city', city)
      url.searchParams.set('cc', cc)

      const response = await fetch(url.toString(), {
        headers: this.headers(this.config.apiKey),
        signal: options?.signal ?? AbortSignal.timeout(10_000),
      })
      // 404 = no confident match; treat as "no twin", not an error.
      if (response.status === 404) return null
      if (!response.ok) {
        console.error(`Foursquare match HTTP error: ${response.status}`)
        return null
      }

      const data = await response.json()
      const place = data?.place ?? data?.result ?? data
      const fsqPlaceId: string | undefined = place?.fsq_place_id
      if (!fsqPlaceId) return null

      // The v2025 match endpoint only returns on a confident match; a
      // match_rate isn't always present, so default to 1 when omitted.
      const matchRate: number = data?.match_rate ?? place?.match_rate ?? 1
      return { fsqPlaceId, matchRate }
    } catch (error) {
      if (this.isAbort(error)) return null
      console.error('Foursquare match error:', error)
      return null
    }
  }

  private readCache(key: string): Place | Place[] | null | undefined {
    const entry = this.cache.get(key)
    if (!entry) return undefined
    if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
      this.cache.delete(key)
      return undefined
    }
    return entry.value
  }

  private writeCache(key: string, value: Place | Place[] | null): void {
    this.cache.set(key, { value, cachedAt: Date.now() })
    if (this.cache.size > MAX_CACHE_ENTRIES) {
      const now = Date.now()
      for (const [k, v] of this.cache) {
        if (now - v.cachedAt > CACHE_TTL_MS) this.cache.delete(k)
      }
      // If still oversized (all fresh), drop the oldest insertion.
      if (this.cache.size > MAX_CACHE_ENTRIES) {
        const oldest = this.cache.keys().next().value
        if (oldest) this.cache.delete(oldest)
      }
    }
  }

  private isAbort(error: unknown): boolean {
    return (
      error instanceof Error &&
      (error.name === 'AbortError' || error.name === 'TimeoutError')
    )
  }
}
