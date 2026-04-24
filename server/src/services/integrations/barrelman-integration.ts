import axios from 'axios'
import { buildGraphHopperCustomModel, getSnapPreventions } from '../../lib/graphhopper-custom-model'
import type {
  Integration,
  IntegrationConfig,
  IntegrationTestResult,
  SearchCapability,
  AutocompleteCapability,
  SearchCategoryCapability,
  PlaceInfoCapability,
  SpatialParentsCapability,
  SpatialChildrenCapability,
  SearchAlongRouteCapability,
  RoutingCapability,
  MapBounds,
} from '../../types/integration.types'
import {
  IntegrationCapabilityId,
  IntegrationId,
} from '../../types/integration.types'
import type {
  RouteRequest,
  UnifiedRoute,
} from '../../types/unified-routing.types'
import { TravelMode, WaypointType } from '../../types/unified-routing.types'
import { getLanguageCode } from '../../lib/i18n'
import { BarrelmanGraphHopperAdapter } from './adapters/barrelman-graphhopper-adapter'
import type {
  Place,
  PlaceGeometry,
  Address,
  AttributedValue,
  OpeningHours,
  OpeningTime,
  PlaceIcon,
} from '../../types/place.types'
import { SOURCE } from '../../lib/constants'
import { matchTags, type GeometryType } from '../../lib/osm-presets'
import { buildPlaceIcon } from '../../lib/place-categories'
import { getPlaceType } from '../../lib/place.utils'
import { parseOsmHours } from '../../lib/hours.utils'

export interface BarrelmanConfig extends IntegrationConfig {
  host: string
  apiKey?: string
  /** Public tile key — sent to client for authenticated tile requests */
  tileKey?: string
}

/**
 * Raw response shape from the Barrelman API (OSM-first schema).
 */
interface BarrelmanPlaceResult {
  id: string              // "node/123456", "way/789", "relation/42"
  osm_type: string        // 'node', 'way', 'relation'
  osm_id: number          // numeric OSM ID
  name?: string | null
  name_abbrev?: string | null
  names?: string[]
  categories?: string[]
  tags: Record<string, string>  // ALL raw OSM tags
  address?: {
    housenumber?: string
    street?: string
    unit?: string
    city?: string
    state?: string
    postcode?: string
    country?: string
  } | null
  hours?: string | null
  phones?: string[]
  websites?: string[]
  geom_type: string       // 'point', 'line', 'area'
  geometry?: {             // centroid GeoJSON
    type: string
    coordinates: number[]
  } | null
  full_geometry?: any | null  // real shape GeoJSON (polygon, linestring, etc.)
  // Search-specific
  text_rank?: number
  distance_m?: number | null
  // Place detail-specific
  area_m2?: number | null
  admin_level?: number | null
}

/**
 * Barrelman geospatial search API integration.
 * Provides fast full-text, trigram, abbreviation, and semantic search
 * over OSM data via PostGIS + pgvector + osm2pgsql.
 */
export class BarrelmanIntegration
  implements Integration<BarrelmanConfig>
{
  private config: BarrelmanConfig = { host: '' }

  readonly integrationId = IntegrationId.BARRELMAN
  readonly sources = [SOURCE.OSM]
  private graphhopperAdapter = new BarrelmanGraphHopperAdapter()

  readonly capabilityIds: IntegrationCapabilityId[] = [
    IntegrationCapabilityId.SEARCH,
    IntegrationCapabilityId.AUTOCOMPLETE,
    IntegrationCapabilityId.SEARCH_CATEGORY,
    IntegrationCapabilityId.PLACE_INFO,
    IntegrationCapabilityId.SPATIAL_PARENTS,
    IntegrationCapabilityId.SPATIAL_CHILDREN,
    IntegrationCapabilityId.SEARCH_ALONG_ROUTE,
    IntegrationCapabilityId.TILE_SERVER,
    IntegrationCapabilityId.ROUTING,
  ]

  readonly capabilities = {
    search: {
      searchPlaces: this.searchPlaces.bind(this),
    } as SearchCapability,
    autocomplete: {
      getAutocomplete: this.getAutocomplete.bind(this),
    } as AutocompleteCapability,
    searchCategory: {
      searchByCategory: this.searchByCategory.bind(this),
    } as SearchCategoryCapability,
    placeInfo: {
      getPlaceInfo: this.getPlaceInfo.bind(this),
    } as PlaceInfoCapability,
    spatialParents: {
      getContainingAreas: this.getContainingAreas.bind(this),
    } as SpatialParentsCapability,
    spatialChildren: {
      getChildren: this.getChildren.bind(this),
    } as SpatialChildrenCapability,
    searchAlongRoute: {
      searchAlongRoute: this.searchAlongRoute.bind(this),
    } as SearchAlongRouteCapability,
    routing: {
      getRoute: this.getRoute.bind(this),
      metadata: {
        supportedPreferences: {
          // Range preferences (GraphHopper supports via custom_model)
          highways: 'range',
          tolls: 'range',
          ferries: 'range',
          hills: 'range',
          surfaceQuality: 'range',
          litPaths: 'range',
          safetyVsSpeed: 'range',

          // Boolean preferences
          shortest: 'boolean',
          preferHOV: false,             // GH has no HOV data
          wheelchairAccessible: false,  // Use dedicated wheelchair mode instead

          // Numeric/enum preferences
          cyclingSpeed: 'range',
          walkingSpeed: 'range',
          bicycleType: 'range',

          // Transit — kept for future custom planner
          maxWalkDistance: 'range',
          maxTransfers: 'range',
        },
        supportedModes: ['driving', 'walking', 'cycling', 'motorcycle', 'truck', 'wheelchair'],
        supportedOptimizations: ['time', 'distance'],
        features: {
          alternatives: true,
          traffic: false,
          elevation: true,
          instructions: true,
          matrix: true,
          transit: false,
        },
        limits: {
          maxWaypoints: 20,
          maxAlternatives: 3,
        },
      },
    } as RoutingCapability,
  }

  // ── Lifecycle ──────────────────────────────────────────────

  async testConnection(config: BarrelmanConfig): Promise<IntegrationTestResult> {
    if (!this.validateConfig(config)) {
      return { success: false, message: 'Invalid configuration: Host is required' }
    }
    // Use /health/auth so we verify both reachability AND the API key. When
    // the server has no BARRELMAN_API_KEY set (dev mode) this still succeeds
    // with no Authorization header. When the server requires auth, a missing
    // or wrong key returns 401 — which /health alone would miss.
    const headers: Record<string, string> = {}
    if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`
    try {
      const response = await axios.get(`${config.host}/health/auth`, {
        headers,
        timeout: 5000,
      })
      if (response.data?.status === 'ok') {
        return { success: true }
      }
      return { success: false, message: 'Barrelman health check failed' }
    } catch (e: any) {
      if (e.response?.status === 401) {
        return {
          success: false,
          message: config.apiKey ? 'Invalid API key' : 'API key required',
        }
      }
      return { success: false, message: `Connection failed: ${e.message}` }
    }
  }

  initialize(config: BarrelmanConfig): void {
    this.config = config
  }

  validateConfig(config: BarrelmanConfig): boolean {
    return Boolean(config.host)
  }

  // ── Adapter ────────────────────────────────────────────────

  private get headers() {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.config.apiKey) {
      h['Authorization'] = `Bearer ${this.config.apiKey}`
    }
    return h
  }

  /**
   * Derive a short, human-readable summary string from raw OSM tags.
   * Operates on the raw tag keys (amenity=bicycle_parking, etc.) so it must
   * be called before we convert placeType to a human-readable label.
   * Returns null when no meaningful chips can be extracted.
   */
  private buildPlaceSummary(tags: Record<string, string>): string | null {
    const t = (k: string) => tags[k]
    const yes = (k: string) => tags[k] === 'yes'
    const no = (k: string) => tags[k] === 'no'
    const chips: string[] = []

    /** Format "n unit(s)" — handles pluralisation */
    const countChip = (n: string, unit: string) => {
      const num = Number(n)
      return `${n} ${unit}${!isNaN(num) && num === 1 ? '' : 's'}`
    }

    // Determine the primary OSM type key
    const primaryKeys = [
      'amenity', 'shop', 'tourism', 'leisure', 'office', 'craft',
      'healthcare', 'natural', 'historic', 'highway', 'railway',
      'waterway', 'man_made', 'emergency', 'aeroway',
    ]
    let osmType = ''
    for (const k of primaryKeys) {
      if (tags[k]) { osmType = tags[k]; break }
    }

    // ── Bicycle parking ──────────────────────────────────────────────────────
    if (osmType === 'bicycle_parking') {
      if (yes('indoor')) chips.push('Indoors')
      else if (yes('covered')) chips.push('Covered')
      const cap = t('capacity')
      if (cap) chips.push(countChip(cap, 'bicycle'))
    }

    // ── Toilets / restrooms ──────────────────────────────────────────────────
    else if (osmType === 'toilets') {
      const access = t('toilets:access') || t('access')
      if (access && access !== 'yes') chips.push(this.fmtWord(access))
      if (yes('fee')) chips.push('Fee required')
      else if (no('fee')) chips.push('Free')
      if (yes('wheelchair')) chips.push('Accessible')
      if (yes('changing_table')) chips.push('Baby changing')
    }

    // ── Parking ──────────────────────────────────────────────────────────────
    else if (osmType === 'parking' || osmType === 'parking_space') {
      if (yes('fee')) chips.push('Paid')
      else if (no('fee')) chips.push('Free')
      const cap = t('capacity')
      if (cap) chips.push(countChip(cap, 'space'))
      const access = t('access')
      if (access && access !== 'yes' && access !== 'public') chips.push(this.fmtWord(access))
      const maxstay = t('maxstay')
      if (maxstay) chips.push(`Max ${maxstay}`)
    }

    // ── EV charging ──────────────────────────────────────────────────────────
    else if (osmType === 'charging_station') {
      const cap = t('capacity')
      if (cap) chips.push(countChip(cap, 'point'))
      if (yes('fee')) chips.push('Paid')
      else if (no('fee')) chips.push('Free')
      const access = t('access')
      if (access && access !== 'yes' && access !== 'public') chips.push(this.fmtWord(access))
    }

    // ── Food & drink ─────────────────────────────────────────────────────────
    else if (['cafe', 'restaurant', 'bar', 'fast_food', 'pub', 'food_court', 'ice_cream', 'food_truck'].includes(osmType)) {
      const cuisine = t('cuisine')
      if (cuisine) chips.push(this.fmtWord(cuisine.split(';')[0].trim()))
      if (yes('outdoor_seating')) chips.push('Outdoor seating')
      if (yes('delivery')) chips.push('Delivery')
    }

    // ── Fuel station ─────────────────────────────────────────────────────────
    else if (osmType === 'fuel') {
      const fuels: string[] = []
      if (yes('fuel:diesel')) fuels.push('Diesel')
      if (yes('fuel:octane_95') || yes('fuel:octane_87')) fuels.push('Regular')
      if (yes('fuel:electric')) fuels.push('EV')
      if (fuels.length) chips.push(fuels.join(', '))
    }

    // ── Drinking water ───────────────────────────────────────────────────────
    else if (osmType === 'drinking_water') {
      if (yes('seasonal')) chips.push('Seasonal')
      if (yes('bottle')) chips.push('Bottle fill')
      if (yes('fee')) chips.push('Fee')
      else if (no('fee')) chips.push('Free')
    }

    // ── Hotel / lodging ──────────────────────────────────────────────────────
    else if (['hotel', 'hostel', 'motel', 'guest_house', 'apartment'].includes(osmType)) {
      const stars = t('stars')
      if (stars) chips.push(`${stars}★`)
      const rooms = t('rooms') || t('beds')
      if (rooms) chips.push(`${rooms} rooms`)
    }

    // ── Generic fallback: surface access/fee when set ────────────────────────
    else {
      const access = t('access')
      if (access && access !== 'yes' && access !== 'public') chips.push(this.fmtWord(access))
      if (yes('fee')) chips.push('Fee required')
      else if (no('fee')) chips.push('Free')
    }

    return chips.length > 0 ? chips.join(' · ') : null
  }

  /** Capitalise words after spaces/start — does not capitalise after apostrophes */
  private fmtWord(v: string): string {
    return v.replace(/[-_]/g, ' ').replace(/(^|[ ])\w/g, m => m.toUpperCase())
  }

  /**
   * Adapt a raw Barrelman result into the unified Place model.
   */
  private adaptPlace(r: BarrelmanPlaceResult): Place {
    const timestamp = new Date().toISOString()
    const sourceId = SOURCE.OSM

    // Geometry — use centroid for center point
    const center =
      r.geometry?.coordinates
        ? { lat: r.geometry.coordinates[1], lng: r.geometry.coordinates[0] }
        : { lat: 0, lng: 0 }

    const geometry: PlaceGeometry = {
      type: 'point',
      center,
    }

    // Convert full GeoJSON geometry to PlaceGeometry format
    if (r.full_geometry) {
      switch (r.full_geometry.type) {
        case 'LineString':
        case 'MultiLineString': {
          geometry.type = 'linestring'
          const coords = r.full_geometry.type === 'LineString'
            ? r.full_geometry.coordinates
            : r.full_geometry.coordinates.flat()
          geometry.nodes = coords.map(([lng, lat]: number[]) => ({ lat, lng }))
          break
        }
        case 'Polygon': {
          geometry.type = 'polygon'
          const rings = r.full_geometry.coordinates
            .filter((ring: any) => ring?.length > 0)
            .map((ring: number[][]) => ring.map(([lng, lat]) => ({ lat, lng })))
          geometry.nodes = rings[0] || []
          geometry.rings = rings
          break
        }
        case 'MultiPolygon': {
          geometry.type = 'multipolygon'
          geometry.polygons = r.full_geometry.coordinates
            .filter((poly: any) => poly?.length > 0)
            .map((poly: number[][][]) =>
              poly
                .filter((ring: any) => ring?.length > 0)
                .map((ring: number[][]) => ring.map(([lng, lat]) => ({ lat, lng })))
            )
          break
        }
      }

      // Compute bounds from the full geometry
      const allCoords: number[][] = []
      const extractCoords = (obj: any) => {
        if (Array.isArray(obj) && obj.length === 2 && typeof obj[0] === 'number') {
          allCoords.push(obj)
        } else if (Array.isArray(obj)) {
          obj.forEach(extractCoords)
        }
      }
      extractCoords(r.full_geometry.coordinates)
      if (allCoords.length > 0) {
        const lngs = allCoords.map(c => c[0])
        const lats = allCoords.map(c => c[1])
        geometry.bounds = {
          minLat: Math.min(...lats),
          minLng: Math.min(...lngs),
          maxLat: Math.max(...lats),
          maxLng: Math.max(...lngs),
        }
      }
    }

    // Address — Barrelman now returns structured addr:* fields
    const address: Address | null = r.address
      ? {
          street1: [r.address.housenumber, r.address.street]
            .filter(Boolean)
            .join(' ') || undefined,
          locality: r.address.city || undefined,
          region: r.address.state || undefined,
          postalCode: r.address.postcode || undefined,
          country: r.address.country || undefined,
        }
      : null

    // Tags are already real OSM tags — use directly for icon/type resolution
    const tags = r.tags || {}
    const summary = this.buildPlaceSummary(tags)
    const osmGeomHint = r.geom_type === 'area' ? 'area' : r.geom_type === 'line' ? 'line' : 'point'
    const presetMatch = matchTags(tags, osmGeomHint as GeometryType)
    const icon: PlaceIcon | undefined = buildPlaceIcon(presetMatch)
    const placeTypeLabel =
      getPlaceType(tags, 'en', osmGeomHint as GeometryType) || r.categories?.[0] || 'place'

    // Contact info
    const phone = r.phones?.length ? r.phones[0] : null

    // Collect all website URLs: DB-extracted primary URLs + any website:* sub-key tags
    const websiteSubTagUrls = Object.entries(r.tags || {})
      .filter(([k, v]) => k.startsWith('website:') && (v.startsWith('http://') || v.startsWith('https://')))
      .map(([, v]) => v)
    const allWebsites = [
      ...(r.websites || []),
      ...websiteSubTagUrls.filter(u => !(r.websites || []).includes(u)),
    ]
    const website = allWebsites[0] || null

    // Opening hours — parse the OSM opening_hours string into structured data
    let openingHours: AttributedValue<OpeningHours> | null = null
    if (r.hours) {
      openingHours = {
        value: parseOsmHours({ ...tags, opening_hours: r.hours }),
        sourceId,
        timestamp,
      }
    }

    // External IDs — the id IS the OSM ID (e.g. "node/5718230659")
    const externalIds: Record<string, string> = {
      [SOURCE.OSM]: r.id,
    }

    // Build OSM URL — r.id is always "node/123456" format, so parse from that
    // (r.osm_type may be stored as uppercase 'N'/'W'/'R' in some DB versions)
    const osmTypeFromId = r.id.split('/')[0] // 'node', 'way', or 'relation'
    const osmUrl = `https://www.openstreetmap.org/${osmTypeFromId}/${r.osm_id}`

    return {
      id: `${SOURCE.OSM}/${r.id}`,
      externalIds,

      name: { value: r.name || null, sourceId, timestamp },
      description: null,
      placeType: { value: placeTypeLabel, sourceId, timestamp },
      icon,

      geometry: { value: geometry, sourceId, timestamp },
      photos: [],
      address: address ? { value: address, sourceId, timestamp } : null,

      contactInfo: {
        phone: phone ? { value: phone, sourceId, timestamp } : null,
        email: null,
        website: website ? { value: website, sourceId, timestamp } : null,
        websites: allWebsites.length ? { value: allWebsites, sourceId, timestamp } : null,
        socials: {},
      },

      openingHours,
      amenities: {},

      tags: r.tags || {},
      summary,

      sources: [
        {
          id: sourceId,
          name: 'OpenStreetMap',
          url: osmUrl,
        },
      ],

      lastUpdated: timestamp,
      createdAt: timestamp,
    }
  }

  // ── Capabilities ───────────────────────────────────────────

  async searchPlaces(
    query: string,
    lat?: number,
    lng?: number,
    options?: { radius?: number; limit?: number },
  ): Promise<Place[]> {
    // Barrelman searches globally for text queries (no spatial filter) and
    // uses proximity re-rank to bias closer results. Radius is passed as a
    // hint but does NOT act as a hard boundary.
    const response = await axios.post(
      `${this.config.host}/search`,
      {
        query,
        lat,
        lng,
        radius: options?.radius,
        limit: options?.limit || 20,
        semantic: true,
      },
      { headers: this.headers, timeout: 10000 },
    )
    return (response.data || []).map((r: any) => this.adaptPlace(r))
  }

  async getAutocomplete(
    query: string,
    lat?: number,
    lng?: number,
    options?: { radius?: number; limit?: number },
  ): Promise<Place[]> {
    // autocomplete: true disables the Ollama semantic layer entirely (it's too slow
    // for typing latency). Relies on parallel FTS + GIN-indexed trigram instead.
    // Barrelman searches globally and uses proximity re-rank for location bias.
    const response = await axios.post(
      `${this.config.host}/search`,
      {
        query,
        lat,
        lng,
        radius: options?.radius,
        limit: options?.limit || 10,
        semantic: false,
        autocomplete: true,
      },
      { headers: this.headers, timeout: 5000 },
    )
    return (response.data || []).map((r: any) => this.adaptPlace(r))
  }

  async searchByCategory(
    presetId: string,
    bounds: MapBounds,
    options?: { limit?: number; filterTags?: Record<string, string> },
  ): Promise<Place[]> {
    const lat = (bounds.north + bounds.south) / 2
    const lng = (bounds.east + bounds.west) / 2
    const latDiff = Math.abs(bounds.north - bounds.south)
    const lngDiff = Math.abs(bounds.east - bounds.west)
    const radius = (Math.max(latDiff, lngDiff) * 111320) / 2

    const response = await axios.post(
      `${this.config.host}/search`,
      {
        lat,
        lng,
        radius: Math.min(radius, 50000),
        categories: [presetId],
        limit: options?.limit || 20,
        ...(options?.filterTags ? { tags: options.filterTags } : {}),
      },
      { headers: this.headers, timeout: 10000 },
    )
    return (response.data || []).map((r: any) => this.adaptPlace(r))
  }

  async getPlaceInfo(id: string): Promise<Place | null> {
    try {
      // ID format: "node/5718230659" — maps to /place/node/5718230659
      const response = await axios.get(
        `${this.config.host}/place/${id}`,
        { headers: this.headers, timeout: 10000 },
      )
      return this.adaptPlace(response.data)
    } catch (e: any) {
      if (e.response?.status === 404) return null
      throw e
    }
  }

  async searchAlongRoute(
    route: { type: 'LineString'; coordinates: number[][] },
    options?: {
      query?: string
      buffer?: number
      categories?: string[]
      tags?: Record<string, string>
      limit?: number
      semantic?: boolean
      autocomplete?: boolean
    },
  ): Promise<Place[]> {
    const response = await axios.post(
      `${this.config.host}/search`,
      {
        ...(options?.query ? { query: options.query } : {}),
        route,
        buffer: options?.buffer,
        categories: options?.categories,
        tags: options?.tags,
        limit: options?.limit || 20,
        semantic: options?.semantic ?? false,
        autocomplete: options?.autocomplete ?? false,
      },
      { headers: this.headers, timeout: 10000 },
    )
    return (response.data || []).map((r: any) => this.adaptPlace(r))
  }

  async getContainingAreas(lat: number, lng: number, exclude?: string): Promise<Place[]> {
    const response = await axios.get(`${this.config.host}/contains`, {
      params: { lat, lng, ...(exclude ? { exclude } : {}) },
      headers: this.headers,
      timeout: 10000,
    })
    return (response.data || []).map((r: any) => this.adaptPlace(r))
  }

  async getChildren(
    areaId: string,
    categories?: string[],
    limit?: number,
    offset?: number,
    lat?: number,
    lng?: number,
  ): Promise<Place[]> {
    const response = await axios.get(`${this.config.host}/children`, {
      params: {
        id: areaId,
        categories: categories?.join(','),
        limit: limit || 20,
        offset: offset || 0,
        ...(lat != null && lng != null ? { lat, lng } : {}),
      },
      headers: this.headers,
      timeout: 10000,
    })
    return (response.data || []).map((r: any) => this.adaptPlace(r))
  }

  // ── Routing (GraphHopper via Barrelman proxy) ──────────────────

  /**
   * Route between waypoints using GraphHopper proxied through Barrelman.
   * Requires `apiKey` in config for authentication.
   */
  private async getRoute(request: RouteRequest): Promise<UnifiedRoute> {
    if (!this.config.apiKey) {
      throw new Error('Barrelman API key is required for routing')
    }

    if (request.waypoints.length < 2) {
      throw new Error('At least 2 waypoints are required for routing')
    }

    const host = this.config.host.replace(/\/$/, '')
    const url = `${host}/route`

    const lang = request.language ? getLanguageCode(request.language) : 'en'

    // Build GraphHopper request body
    const snapPreventions = getSnapPreventions(request.mode)
    const requestBody: Record<string, any> = {
      points: request.waypoints.map((wp) => [wp.coordinate.lng, wp.coordinate.lat]),
      profile: this.mapTravelModeToProfile(request.mode),
      elevation: true,
      points_encoded: false,
      instructions: request.includeInstructions ?? true,
      locale: lang,
      // Prevent origin/dest from snapping directly onto motorways, tunnels, etc.
      // so the router joins them via proper on-/off-ramps.
      ...(snapPreventions && { snap_preventions: snapPreventions }),
      // Request all path details for enriched response
      details: [
        'surface', 'road_class', 'road_environment', 'road_access',
        'bike_network', 'get_off_bike', 'smoothness', 'track_type',
        'average_slope', 'max_slope', 'average_speed', 'max_speed',
        'bike_priority',
      ],
    }

    // Alternatives
    if (request.preferences?.alternatives) {
      requestBody.algorithm = 'alternative_route'
      requestBody['alternative_route.max_paths'] = request.preferences.maxAlternatives ?? 3
    }

    // Apply custom_model for preference-based routing
    const customModel = this.buildCustomModel(request)
    if (customModel) {
      requestBody.custom_model = customModel
    }

    try {
      const response = await axios.post(url, requestBody, {
        headers: this.headers,
        timeout: 30_000,
      })

      return this.graphhopperAdapter.adaptRouteResponse(response.data, request)
    } catch (error: any) {
      if (error.response) {
        const status = error.response.status
        const detail = error.response.data?.message ?? error.response.statusText
        throw new Error(`Barrelman routing error (${status}): ${detail}`)
      }
      throw new Error(
        `Barrelman routing error: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      )
    }
  }

  // ── GraphHopper profile mapping ───────────────────────────────

  private mapTravelModeToProfile(mode: TravelMode): string {
    switch (mode) {
      case TravelMode.DRIVING:
        return 'car'
      case TravelMode.CYCLING:
        return 'bike'
      case TravelMode.WALKING:
        return 'foot'
      case TravelMode.MOTORCYCLE:
        return 'car' // GraphHopper doesn't have a separate motorcycle profile
      case TravelMode.TRUCK:
        return 'car' // Use car with custom_model constraints for truck
      case TravelMode.WHEELCHAIR:
        return 'foot' // Use foot profile with custom_model to avoid stairs, curbs, etc.
      default:
        throw new Error(`Unsupported travel mode: ${mode}`)
    }
  }

  /**
   * Build a GraphHopper custom_model from unified routing preferences.
   * Delegates to the shared utility in lib/graphhopper-custom-model.ts
   */
  private buildCustomModel(request: RouteRequest): Record<string, any> | undefined {
    return buildGraphHopperCustomModel(request.mode, request.preferences)
  }
}
