import type { Place, TransitDeparture, TransitStopInfo, WidgetDescriptor, WidgetResponse, SourceReference, RelatedPlacesData, RelatedPlacesStrategy, RelatedParent, DisplayChip } from '../types/place.types'
import { WidgetType, WidgetDataType } from '../types/place.types'

import { SOURCE } from '../lib/constants'
import { IntegrationId } from '../types/integration.enums'
import { integrationManager } from './integrations'
import { IntegrationCapabilityId } from '../types/integration.types'
import { OverpassIntegration } from './integrations/overpass-integration'
import { BarrelmanIntegration } from './integrations/barrelman-integration'
import { isTransitStop } from '../lib/transit-utils'
import { matchTags } from '../lib/osm-presets'
import { buildPlaceIcon } from '../lib/place-categories'
import * as turf from '@turf/turf'
import { resolveDisplayChips } from '../lib/display-chips'

/**
 * Check if a place is a transit stop based on its OSM tags/type.
 * Used to detect transit stops that don't have stored transit info.
 */
function isPlaceTransitStopFromTags(place: Place): boolean {
  const placeType = typeof place.placeType === 'string'
    ? place.placeType
    : place.placeType?.value || ''
  // amenities is Record<string, AttributedValue> — extract raw string values
  const tags: Record<string, string> = {}
  if (place.amenities && typeof place.amenities === 'object') {
    for (const [key, attr] of Object.entries(place.amenities)) {
      if (attr?.value != null) tags[key] = String(attr.value)
    }
  }
  return isTransitStop(placeType, tags)
}

// ─── Integration helpers ─────────────────────────────────────────────────────

function getBarrelmanInstance(): BarrelmanIntegration | null {
  const record = integrationManager
    .getConfiguredIntegrationsByCapability(IntegrationCapabilityId.SPATIAL_CHILDREN)
    .find((r) => r.integrationId === 'barrelman')
  return record
    ? (integrationManager.getCachedIntegrationInstance(record) as BarrelmanIntegration | null)
    : null
}

function getBarrelmanContainsInstance(): BarrelmanIntegration | null {
  const record = integrationManager
    .getConfiguredIntegrationsByCapability(IntegrationCapabilityId.SPATIAL_PARENTS)
    .find((r) => r.integrationId === 'barrelman')
  return record
    ? (integrationManager.getCachedIntegrationInstance(record) as BarrelmanIntegration | null)
    : null
}

function getOverpassInstance(): OverpassIntegration | null {
  const record = integrationManager
    .getConfiguredIntegrationsByCapability(IntegrationCapabilityId.SEARCH_CATEGORY)
    .find((r) => r.integrationId === 'overpass')
  return record
    ? (integrationManager.getCachedIntegrationInstance(record) as OverpassIntegration | null)
    : null
}

// ─── OSM Tag filtering ───────────────────────────────────────────────────────

/** Tags already shown in other UI sections — don't repeat them */
const EXCLUDE_OSM_TAG_KEYS = new Set([
  // Names — shown in title
  'name', 'old_name', 'alt_name', 'short_name', 'official_name', 'loc_name', 'int_name',
  // Metadata / editorial
  'source', 'created_by', 'note', 'fixme', 'FIXME', 'todo', 'description',
  // Contact — shown in contact section
  'phone', 'fax', 'email', 'website', 'url',
  // Hours — shown in hours section
  'opening_hours', 'service_times',
  // External references
  'wikidata', 'wikipedia', 'wikimedia_commons', 'is_in', 'geonames', 'image', 'mapillary',
  // Primary type classification keys — these ARE the place type shown as the subtitle
  // e.g. amenity=bicycle_parking is already "Bicycle Parking", shop=bakery is already "Bakery"
  'amenity', 'shop', 'tourism', 'leisure', 'office', 'craft', 'healthcare',
  'natural', 'historic', 'highway', 'railway', 'waterway', 'building',
  'man_made', 'public_transport', 'landuse', 'boundary', 'type',
  'emergency', 'power', 'military', 'sport', 'aeroway', 'place', 'barrier',
])
const EXCLUDE_OSM_TAG_PREFIXES = [
  'addr:', 'source:', 'contact:', 'name:', 'old_name:', 'opening_hours:',
  'alt_name:', 'official_name:', 'check_date', 'survey:date', 'disused:',
  // website:* sub-keys (website:menu, website:facebook, etc.) are surfaced in the contact panel
  'website:',
]

/** Wikidata QID pattern — these are reference IDs, not useful to display */
const WIKIDATA_QID_RE = /^Q\d+$/

/** Return a copy of tags with noise/redundant keys removed */
function filterOsmTags(tags: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(tags)) {
    if (EXCLUDE_OSM_TAG_KEYS.has(key)) continue
    if (EXCLUDE_OSM_TAG_PREFIXES.some(p => key.startsWith(p))) continue
    if (!value || value.trim() === '') continue
    // Skip Wikidata QID values — they're external reference IDs, not readable info
    if (WIKIDATA_QID_RE.test(value.trim())) continue
    result[key] = value
  }
  return result
}

/**
 * Inspect a place and return the list of widget descriptors that apply.
 * These descriptors tell the client which widgets to render and what
 * params to pass when fetching widget data.
 */
export function resolveWidgetDescriptors(place: Place): WidgetDescriptor[] {
  const descriptors: WidgetDescriptor[] = []

  // ── 1. Transit (ASYNC) ──────────────────────────────────────────────────────
  // Detect transit stops by either stored transit info or OSM tags.
  // Departure data is fetched from Barrelman (MOTIS) using coordinates.
  const transitInfo = place.transit?.value
  const hasTransitInfo = transitInfo && (transitInfo.onestopId || transitInfo.stopId || transitInfo.feedId)
  const isTransitByTags = place.geometry?.value?.center && isPlaceTransitStopFromTags(place)

  if (hasTransitInfo || isTransitByTags) {
    const center = place.geometry?.value?.center
    if (center) {
      descriptors.push({
        type: WidgetType.TRANSIT,
        dataType: WidgetDataType.ASYNC,
        title: transitInfo?.name || place.name?.value || 'Transit Departures',
        estimatedHeight: 200,
        params: {
          lat: String(center.lat),
          lng: String(center.lng),
          ...(transitInfo?.feedId ? { feedId: transitInfo.feedId } : {}),
          ...(transitInfo?.stopId ? { stopId: transitInfo.stopId } : {}),
          // Keep onestopIds for backwards compatibility with cached data
          ...(transitInfo?.onestopId ? { onestopIds: (transitInfo.onestopIds || [transitInfo.onestopId]).join(',') } : {}),
        },
      })
    }
  }

  // ── 2. OSM Tags (STATIC) + Display Chips ──────────────────────────────────
  // Extract chip-eligible tags first, then embed remaining tags in the widget.
  {
    const rawTags = place.tags
    if (rawTags && Object.keys(rawTags).length > 0) {
      // Resolve display chips from raw tags
      const { chips, remainingTags } = resolveDisplayChips(rawTags)
      if (chips.length > 0) {
        place.displayChips = chips
      }

      // Use remaining tags (chip keys removed) for the list-item widget
      const filtered = filterOsmTags(remainingTags)
      if (Object.keys(filtered).length > 0) {
        // Pre-build the full WidgetResponse so the client can render immediately.
        const staticResponse: WidgetResponse = {
          type: WidgetType.OSM_TAGS,
          data: {
            value: filtered,
            sourceId: SOURCE.OSM,
            timestamp: new Date().toISOString(),
          },
          sources: [{ id: SOURCE.OSM, name: 'OpenStreetMap', url: 'https://www.openstreetmap.org' }],
        }
        descriptors.push({
          type: WidgetType.OSM_TAGS,
          dataType: WidgetDataType.STATIC,
          title: 'Details',
          estimatedHeight: 0, // not used — static widgets render without a skeleton
          params: {
            staticData: JSON.stringify(staticResponse),
          },
        })
      }
    }
  }

  // ── 3. Related Places (ASYNC) ────────────────────────────────────────────
  {
    const osmId = place.externalIds?.[SOURCE.OSM]
    const osmType = osmId?.split('/')[0]
    const center = place.geometry?.value?.center
    const bounds = place.geometry?.value?.bounds
    const placeTypeLower = place.placeType?.value?.toLowerCase() || ''

    const hasBounds = Boolean(place.geometry?.value?.bounds)
    const isAreaPlace = osmType === 'way' || osmType === 'relation' || hasBounds
    const adminTypes = ['city', 'town', 'village', 'suburb', 'neighbourhood', 'borough', 'county', 'state', 'country']
    const isAdminPlace = adminTypes.includes(placeTypeLower)

    // A "container" is an area place with defined nearby categories (i.e. we know what to look for inside it)
    const hasNearbyCategories = Boolean(place.nearbyCategories?.length)
    const isContainerPlace = isAreaPlace && hasNearbyCategories

    if (center) {
      if (osmId) {
        // Children strategy: show interesting POIs inside this area
        if (isContainerPlace) {
          descriptors.push({
            type: WidgetType.RELATED_PLACES,
            dataType: WidgetDataType.ASYNC,
            title: 'Related Places',
            estimatedHeight: 110,
            params: {
              strategy: 'children' as RelatedPlacesStrategy,
              osmId,
              lat: String(center.lat),
              lng: String(center.lng),
              south: String(bounds?.minLat || ''),
              west: String(bounds?.minLng || ''),
              north: String(bounds?.maxLat || ''),
              east: String(bounds?.maxLng || ''),
              presetIds: place.nearbyCategories!.map((c) => c.presetId).join(','),
              placeId: place.id,
              limit: '20',
              offset: '0',
            },
          })
        }

        if (isAdminPlace) {
          // Admin strategy: show next-level-up administrative boundary
          descriptors.push({
            type: WidgetType.RELATED_PLACES,
            dataType: WidgetDataType.ASYNC,
            title: 'Related Places',
            estimatedHeight: 76,
            params: {
              strategy: 'admin' as RelatedPlacesStrategy,
              osmId,
              lat: String(center.lat),
              lng: String(center.lng),
              south: '', west: '', north: '', east: '',
              presetIds: '',
              placeId: place.id,
            },
          })
        } else {
          // Parent strategy: show the containing area for any non-admin place
          descriptors.push({
            type: WidgetType.RELATED_PLACES,
            dataType: WidgetDataType.ASYNC,
            title: 'Related Places',
            estimatedHeight: 76,
            params: {
              strategy: 'parent' as RelatedPlacesStrategy,
              osmId,
              lat: String(center.lat),
              lng: String(center.lng),
              south: '', west: '', north: '', east: '',
              presetIds: '',
              placeId: place.id,
            },
          })
        }
      } else {
        // No OSM ID (e.g. coordinate lookup) — still show parent containers
        descriptors.push({
          type: WidgetType.RELATED_PLACES,
          dataType: WidgetDataType.ASYNC,
          title: 'Related Places',
          estimatedHeight: 76,
          params: {
            strategy: 'parent' as RelatedPlacesStrategy,
            osmId: '',
            lat: String(center.lat),
            lng: String(center.lng),
            south: '', west: '', north: '', east: '',
            presetIds: '',
            placeId: place.id,
          },
        })
      }
    }
  }

  return descriptors
}

/**
 * Fetch transit departure data from Barrelman (MOTIS stoptimes).
 *
 * Accepts either coordinates (lat/lng) or feedId+stopId. Barrelman
 * finds nearby GTFS stops, queries MOTIS for timetable data, and
 * enriches with route colors from the GTFS database.
 */
async function fetchTransitDepartures(
  params: { lat: number; lng: number; feedId?: string; stopId?: string },
  options?: { limit?: number },
): Promise<{
  departures: TransitDeparture[]
  stopInfo?: { name?: string; code?: string; feedId?: string; stopId?: string; timezone?: string }
  routes?: TransitStopInfo['routes']
  sources: SourceReference[]
}> {
  const { limit = 50 } = options || {}

  const barrelmanRecord = integrationManager
    .getConfiguredIntegrations()
    .find((i) => i.integrationId === IntegrationId.BARRELMAN)

  const config = barrelmanRecord?.config as { host?: string; apiKey?: string } | undefined
  if (!config?.host) {
    console.debug('🚫 [Widget/Transit] Barrelman not configured')
    return { departures: [], sources: [] }
  }

  try {
    const queryParams = new URLSearchParams({
      lat: String(params.lat),
      lng: String(params.lng),
      n: String(limit),
    })
    if (params.feedId) queryParams.set('feedId', params.feedId)
    if (params.stopId) queryParams.set('stopId', params.stopId)

    const headers: Record<string, string> = {}
    if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`

    console.debug(`🌐 [Widget/Transit] Fetching departures from Barrelman at (${params.lat}, ${params.lng})`)
    const response = await fetch(`${config.host}/transit/departures?${queryParams}`, { headers })

    if (!response.ok) {
      console.error(`❌ [Widget/Transit] Barrelman returned ${response.status}`)
      return { departures: [], sources: [] }
    }

    const stopResults = await response.json() as Array<{
      stop: { stopId: string; feedId: string; name: string; code?: string; lat: number; lng: number; timezone: string; distance?: number }
      departures: Array<{
        tripId: string
        route: { id: string; feedId: string; shortName?: string; longName?: string; type: number; color?: string; textColor?: string; agencyId?: string; agencyName?: string }
        headsign?: string
        directionId?: string
        departureTime: string
        arrivalTime: string
        scheduledDepartureTime: string
        scheduledArrivalTime: string
        delay?: number
        realTime: boolean
        cancelled: boolean
        mode: string
        tripOrigin?: string
        tripDestination?: string
      }>
    }>

    // Flatten all stops' departures into a single list
    const allDepartures: TransitDeparture[] = []
    let primaryStop: typeof stopResults[0]['stop'] | undefined

    for (const stopResult of stopResults) {
      if (!primaryStop) primaryStop = stopResult.stop

      for (const dep of stopResult.departures) {
        allDepartures.push({
          departureTime: dep.departureTime,
          arrivalTime: dep.arrivalTime,
          departureAt: dep.departureTime,
          arrivalAt: dep.arrivalTime,
          scheduledDepartureTime: dep.scheduledDepartureTime,
          scheduledArrivalTime: dep.scheduledArrivalTime,
          timezone: stopResult.stop.timezone,
          delay: dep.delay,
          realTime: dep.realTime,
          headsign: dep.headsign,
          direction: dep.headsign,
          trip: {
            id: dep.tripId,
            headsign: dep.headsign,
            directionId: dep.directionId ? Number(dep.directionId) : undefined,
            routeId: dep.route.id,
          },
          route: {
            id: dep.route.id,
            shortName: dep.route.shortName,
            longName: dep.route.longName,
            color: dep.route.color,
            textColor: dep.route.textColor,
            type: dep.route.type,
            agencyId: dep.route.agencyId,
          },
          agency: dep.route.agencyName ? {
            id: dep.route.agencyId || '',
            name: dep.route.agencyName,
          } : undefined,
        })
      }
    }

    // Sort by departure time
    allDepartures.sort((a, b) => {
      const timeA = a.departureAt || a.departureTime || ''
      const timeB = b.departureAt || b.departureTime || ''
      return timeA.localeCompare(timeB)
    })

    console.debug(`✅ [Widget/Transit] Got ${allDepartures.length} departures from ${stopResults.length} stop(s)`)

    const sources: SourceReference[] = allDepartures.length > 0
      ? [{ id: 'barrelman', name: 'GTFS Timetable' }]
      : []

    // All lines serving the stop — aggregated across its station complex
    // (agency transfers.txt), not just the routes departing soon. The
    // "N Q R W S 1 2 3 7" badge row for a station like Times Sq.
    let routes: TransitStopInfo['routes']
    if (primaryStop) {
      try {
        const routesRes = await fetch(
          `${config.host}/transit/routes?feedId=${encodeURIComponent(primaryStop.feedId)}&stopId=${encodeURIComponent(primaryStop.stopId)}`,
          { headers },
        )
        if (routesRes.ok) {
          const rows = await routesRes.json() as Array<{
            routeId: string; routeShortName?: string; routeLongName?: string
            routeType?: number; routeColor?: string; routeTextColor?: string
          }>
          routes = rows.map((r) => ({
            id: r.routeId,
            shortName: r.routeShortName,
            longName: r.routeLongName,
            color: r.routeColor,
            textColor: r.routeTextColor,
            type: r.routeType,
          }))
        }
      } catch {
        // Route list is an enhancement — departures still render without it
      }
    }

    return {
      departures: allDepartures,
      stopInfo: primaryStop ? {
        name: primaryStop.name,
        code: primaryStop.code,
        feedId: primaryStop.feedId,
        stopId: primaryStop.stopId,
        timezone: primaryStop.timezone,
      } : undefined,
      routes,
      sources,
    }
  } catch (error) {
    console.error('❌ [Widget/Transit] Barrelman departure fetch failed:', error)
    return { departures: [], sources: [] }
  }
}

/**
 * Fetch widget data by type. Dispatches to the appropriate handler.
 */
export async function fetchWidgetData(
  type: WidgetType,
  params: Record<string, string>,
): Promise<WidgetResponse> {
  switch (type) {
    case WidgetType.TRANSIT: {
      const lat = params.lat ? parseFloat(params.lat) : NaN
      const lng = params.lng ? parseFloat(params.lng) : NaN
      const limit = params.limit ? parseInt(params.limit, 10) : undefined

      if (isNaN(lat) || isNaN(lng)) {
        throw new Error('Missing lat/lng parameters for transit widget')
      }

      const { departures, stopInfo, routes, sources } = await fetchTransitDepartures(
        {
          lat,
          lng,
          feedId: params.feedId || undefined,
          stopId: params.stopId || undefined,
        },
        { limit },
      )

      const transitInfo: TransitStopInfo = {
        departures,
        routes,
        name: stopInfo?.name,
        code: stopInfo?.code,
        feedId: stopInfo?.feedId,
        stopId: stopInfo?.stopId,
        timezone: stopInfo?.timezone,
        lat,
        lng,
        // Preserve onestop ID if passed through (for tile layer linking)
        ...(params.onestopIds ? {
          onestopId: params.onestopIds.split(',')[0],
          onestopIds: params.onestopIds.split(','),
        } : {}),
      }

      return {
        type: WidgetType.TRANSIT,
        data: {
          value: transitInfo,
          sourceId: 'barrelman',
          timestamp: new Date().toISOString(),
        },
        sources,
      }
    }

    case WidgetType.RELATED_PLACES: {
      return await fetchRelatedPlaces(params)
    }

    case WidgetType.OSM_TAGS: {
      const tags = params.tagsJson ? JSON.parse(params.tagsJson) as Record<string, string> : {}
      return {
        type: WidgetType.OSM_TAGS,
        data: {
          value: tags,
          sourceId: SOURCE.OSM,
          timestamp: new Date().toISOString(),
        },
        sources: Object.keys(tags).length > 0
          ? [{ id: SOURCE.OSM, name: 'OpenStreetMap', url: 'https://www.openstreetmap.org' }]
          : [],
      }
    }

    default:
      throw new Error(`Unknown widget type: ${type}`)
  }
}

// ─── Related Places ─────────────────────────────────────────────────────────

/**
 * Fetch related places using the appropriate strategy.
 */
async function fetchRelatedPlaces(
  params: Record<string, string>,
): Promise<WidgetResponse<RelatedPlacesData>> {
  const strategy = (params.strategy || 'children') as RelatedPlacesStrategy
  const osmId = params.osmId || ''
  const lat = parseFloat(params.lat || '0')
  const lng = parseFloat(params.lng || '0')
  const presetIds = (params.presetIds || '').split(',').filter(Boolean)
  const placeId = params.placeId || ''
  const limit = parseInt(params.limit || '20', 10)
  const offset = parseInt(params.offset || '0', 10)

  // Parse optional bounding box (passed from place.geometry.value.bounds)
  const south = params.south ? parseFloat(params.south) : undefined
  const west = params.west ? parseFloat(params.west) : undefined
  const north = params.north ? parseFloat(params.north) : undefined
  const east = params.east ? parseFloat(params.east) : undefined
  const bbox = (south !== undefined && west !== undefined && north !== undefined && east !== undefined)
    ? { south, west, north, east }
    : undefined

  let children: Place[] = []
  let parents: RelatedParent[] = []
  let hasMore = false

  switch (strategy) {
    case 'children': {
      const result = await fetchChildrenInArea(osmId, presetIds, placeId, lat, lng, bbox, limit, offset)
      children = result.children
      hasMore = result.hasMore
      break
    }
    case 'parent':
      parents = await fetchParentPlaces(osmId, lat, lng, false)
      break
    case 'admin':
      parents = await fetchParentPlaces(osmId, lat, lng, true)
      break
  }

  return {
    type: WidgetType.RELATED_PLACES,
    data: {
      value: { strategy, children, parents, centerLat: lat, centerLng: lng, hasMore, offset },
      sourceId: SOURCE.OSM,
      timestamp: new Date().toISOString(),
    },
    sources: (children.length || parents.length)
      ? [{ id: SOURCE.OSM, name: 'OpenStreetMap', url: 'https://www.openstreetmap.org' }]
      : [],
  }
}

// ─── Children scoring helpers ────────────────────────────────────────────────

/** OSM types too granular/noisy to show when unnamed. */
const REQUIRE_NAME_TYPES = new Set([
  'bench', 'picnic_table', 'waste_basket', 'waste_bin', 'recycling',
  'bollard', 'fire_hydrant', 'street_lamp', 'manhole', 'post_box',
  'information', 'guidepost', 'advertising', 'vending_machine',
])

/** Structural OSM types that are always shown even when unnamed. */
const STRUCTURAL_TYPES = new Set([
  'apartment building', 'apartment complex', 'building', 'residential building',
  'commercial building', 'office building', 'dormitory',
])

/** Max number of unnamed non-structural items of the same type to include. */
const MAX_UNNAMED_PER_TYPE = 2

interface ScoredPlace {
  place: Place
  relevance: number
  presetOrder: number
  dist: number
}

/**
 * Filter, score, sort, and deduplicate a flat list of candidate child places.
 * Returns a ranked array ready for pagination.
 */
function scoreAndRankChildren(
  places: Place[],
  excludeId: string,
  presetIds: string[],
  centerLat: number,
  centerLng: number,
): Place[] {
  const centerPoint = turf.point([centerLng, centerLat])

  const scored: ScoredPlace[] = places
    .filter((p) => p.id !== excludeId)
    .filter((p) => {
      const hasName = Boolean(p.name?.value)
      if (hasName) return true
      const addr = p.address?.value
      if (addr?.street || addr?.housenumber || addr?.full) return true
      const typeRaw = (p.placeType?.value || '').toLowerCase().replace(/\s+/g, '_')
      return !REQUIRE_NAME_TYPES.has(typeRaw)
    })
    .map((p) => {
      const hasName = Boolean(p.name?.value)
      const addr = p.address?.value
      const hasAddress = Boolean(addr?.street || addr?.housenumber || addr?.full)
      const relevance = (hasName ? 2 : 0) + (hasAddress ? 1 : 0)

      const presetId = p.icon?.presetId || ''
      const idx = presetIds.findIndex((pid) => presetId === pid || presetId.startsWith(pid))
      const presetOrder = idx === -1 ? presetIds.length : idx

      const center = p.geometry?.value?.center
      const dist = center
        ? turf.distance(centerPoint, turf.point([center.lng, center.lat]), { units: 'meters' })
        : Infinity

      return { place: p, relevance, presetOrder, dist }
    })

  scored.sort((a, b) => b.relevance - a.relevance || a.presetOrder - b.presetOrder || a.dist - b.dist)

  const typeCount = new Map<string, number>()
  return scored
    .filter(({ place, relevance }) => {
      if (relevance > 0) return true
      const typeKey = (place.placeType?.value || '').toLowerCase()
      if (STRUCTURAL_TYPES.has(typeKey)) return true
      const count = typeCount.get(typeKey) || 0
      if (count >= MAX_UNNAMED_PER_TYPE) return false
      typeCount.set(typeKey, count + 1)
      return true
    })
    .map((s) => s.place)
}

/**
 * Children strategy: find POIs within an OSM area.
 * Uses bounding box query when bounds are available (preferred: faster, more reliable).
 * Falls back to Overpass area query when no bounds provided.
 */
async function fetchChildrenInArea(
  osmId: string,
  presetIds: string[],
  excludePlaceId: string,
  centerLat: number,
  centerLng: number,
  bbox?: { south: number; west: number; north: number; east: number },
  limit = 20,
  offset = 0,
): Promise<{ children: Place[]; hasMore: boolean }> {
  // Try Barrelman first
  const barrelman = getBarrelmanInstance()
  if (barrelman) {
    try {
      console.debug(`🌐 [Widget/RelatedPlaces] Fetching children via Barrelman for ${osmId} (limit=${limit}, offset=${offset})`)
      const children = await barrelman.getChildren(osmId, presetIds, limit + 1, offset, centerLat, centerLng)
      if (children.length || offset > 0) {
        const hasMore = children.length > limit
        const page = children.slice(0, limit).filter((p) => p.id !== excludePlaceId)
        console.debug(`✅ [Widget/RelatedPlaces] Barrelman returned ${page.length} children (hasMore=${hasMore})`)
        return { children: page, hasMore }
      }
    } catch (error) {
      console.debug('⚠️ [Widget/RelatedPlaces] Barrelman children query failed, falling back to Overpass:', error)
    }
  }

  // Fallback: Overpass
  const overpass = getOverpassInstance()
  if (!overpass) {
    console.debug('🚫 [Widget/RelatedPlaces] Overpass integration not configured')
    return { children: [], hasMore: false }
  }

  console.debug(`🌐 [Widget/RelatedPlaces] Fetching children in ${osmId} for ${presetIds.length} categories via Overpass (bbox: ${bbox ? 'yes' : 'no'})`)
  const places = await overpass.searchByCategoryInArea(osmId, presetIds, { limit: 50, bbox })

  const ranked = scoreAndRankChildren(places, excludePlaceId, presetIds, centerLat, centerLng)
  const page = ranked.slice(offset, offset + limit)
  const hasMore = ranked.length > offset + limit
  return { children: page, hasMore }
}

/**
 * Parent strategy: find the most specific interesting area spatially containing this place.
 * Uses Overpass is_in() as the primary source — works purely on geometry, so it finds
 * spatial parents (e.g. the park containing a playground) even without explicit OSM
 * relation membership. Falls back to Nominatim hierarchy for admin-only lookups.
 */
async function fetchParentPlaces(
  osmId: string,
  lat: number,
  lng: number,
  adminOnly: boolean,
): Promise<RelatedParent[]> {
  if (!lat || !lng) return []

  // Try Barrelman first for spatial contains queries
  {
    const barrelman = getBarrelmanContainsInstance()
    if (barrelman) {
      try {
        console.debug(`🌐 [Widget/Parent] Finding containers via Barrelman for (${lat},${lng})`)
        const containers = await barrelman.getContainingAreas(lat, lng, osmId)
        if (containers.length) {
          // Filter self-references: c.id is "osm/way/123", osmId is "way/123"
          const nonSelf = osmId
            ? containers.filter((c) => {
                const cOsmId = c.externalIds?.[SOURCE.OSM] || ''
                return cOsmId !== osmId && c.id !== osmId && c.id !== `osm/${osmId}`
              })
            : containers
          console.debug(`✅ [Widget/Parent] Barrelman returned ${nonSelf.length} containers`)
          if (nonSelf.length) {
            return nonSelf.map((c) => ({
              id: c.id,
              name: c.name?.value || 'Unknown',
              placeType: c.placeType?.value,
              icon: c.icon,
            }))
          }
        }
      } catch (error) {
        console.debug('⚠️ [Widget/Parent] Barrelman contains query failed, falling back:', error)
      }
    }
  }

  if (!adminOnly) {
    // Fallback: Overpass is_in for spatial containment
    const overpass = getOverpassInstance()
    if (overpass && lat && lng) {
      try {
        console.debug(`🌐 [Widget/Parent] Finding containers for (${lat},${lng}) via Overpass is_in`)
        const containers = await overpass.findContainingAreas(lat, lng)
        if (containers.length) {
          // Filter out self-reference and building parts
          const nonSelf = containers.filter((c) => {
            if (c.id === osmId || c.id === `osm/${osmId}`) return false
            if (c.tags?.['building:part']) return false
            return true
          })
          console.debug(`✅ [Widget/Parent] Found ${nonSelf.length} containers via is_in (${containers.length - nonSelf.length} self-refs removed)`)
          if (nonSelf.length) {
            return nonSelf.map((c) => ({
              id: c.id,
              name: c.name,
              placeType: c.placeType,
              icon: buildPlaceIcon(matchTags(c.tags || {}, 'area')),
              tags: c.tags,
            }))
          }
        }
      } catch (error) {
        console.error('❌ [Widget/Parent] is_in query failed, falling back to Nominatim:', error)
      }
    }
  }

  // Admin strategy (or is_in fallback): use Nominatim hierarchy
  const nominatimIntegration = integrationManager.getIntegration('nominatim')
  if (!nominatimIntegration) {
    console.debug('🚫 [Widget/RelatedPlaces] Nominatim integration not configured')
    return []
  }

  try {
    const baseUrl = nominatimIntegration.config.baseUrl || 'https://nominatim.openstreetmap.org'
    const relations = await nominatimIntegration.adapter.lookupParentRelations(osmId, baseUrl)

    if (!relations.length) return []

    const filtered = relations.filter((rel) => {
      const tags = rel.tags || {}
      if (adminOnly) {
        return tags.admin_level || tags.boundary === 'administrative'
      }
      return (
        tags.amenity || tags.landuse || tags.leisure || tags.tourism ||
        tags.shop || tags.type === 'site' || tags.type === 'multipolygon'
      )
    })

    const parents: RelatedParent[] = filtered.map((rel) => ({
      id: rel.id,
      name: rel.name || 'Unknown',
      placeType: rel.placeType || 'Area',
      tags: rel.tags,
    }))

    // Admin: pick the most specific (first) admin level
    if (adminOnly && parents.length > 1) {
      return [parents[0]]
    }

    return parents
  } catch (error) {
    console.error('❌ [Widget/RelatedPlaces] Error fetching parent places:', error)
    return []
  }
}
