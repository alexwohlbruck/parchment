import type { Place, TransitDeparture, TransitStopInfo, WidgetDescriptor, WidgetResponse, SourceReference, RelatedPlacesData, RelatedPlacesStrategy, RelatedParent } from '../types/place.types'
import { WidgetType, WidgetDataType } from '../types/place.types'

import { SOURCE } from '../lib/constants'
import { integrationManager } from './integrations'
import { IntegrationCapabilityId } from '../types/integration.types'
import { TransitlandIntegration } from './integrations/transitland-integration'
import { OverpassIntegration } from './integrations/overpass-integration'
import { BarrelmanIntegration } from './integrations/barrelman-integration'
import { matchTags } from '../lib/osm-presets'
import { buildPlaceIcon } from '../lib/place-categories'
import * as turf from '@turf/turf'

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
  if (place.transit?.value?.onestopId) {
    const transit = place.transit.value
    const onestopIds = transit.onestopIds || [transit.onestopId]

    descriptors.push({
      type: WidgetType.TRANSIT,
      dataType: WidgetDataType.ASYNC,
      title: transit.name || 'Transit Departures',
      estimatedHeight: 200,
      params: {
        onestopIds: onestopIds.join(','),
      },
    })
  }

  // ── 2. OSM Tags (STATIC) ─────────────────────────────────────────────────
  // Data is embedded in the descriptor — no extra API call needed.
  {
    const rawTags = place.tags
    if (rawTags && Object.keys(rawTags).length > 0) {
      const filtered = filterOsmTags(rawTags)
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

    if (osmId && center) {
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
    }
  }

  return descriptors
}

/**
 * Fetch transit departure data for the given onestop IDs.
 * Extracted from the former enrichPlaceWithTransitData() in place.service.ts.
 */
async function fetchTransitDepartures(
  onestopIds: string[],
  options?: { next?: number; limit?: number },
): Promise<{ departures: TransitDeparture[]; sources: SourceReference[] }> {
  const { next = 3600, limit = 20 } = options || {}

  const transitlandRecord = integrationManager.getConfiguredIntegrationForSource(
    SOURCE.TRANSITLAND,
    IntegrationCapabilityId.TRANSIT_DATA,
  )
  const transitland = transitlandRecord
    ? integrationManager.getCachedIntegrationInstance(transitlandRecord) as TransitlandIntegration | null
    : null

  if (!transitland) {
    console.debug('🚫 [Widget/Transit] Transitland integration not configured')
    return { departures: [], sources: [] }
  }

  const allDepartures: TransitDeparture[] = []

  for (const onestopId of onestopIds) {
    try {
      console.debug(`🌐 [Widget/Transit] Fetching departures for ${onestopId}`)
      const departures = await transitland.getDepartures(onestopId, { next, limit })

      if (departures?.length) {
        console.debug(`✅ [Widget/Transit] Found ${departures.length} departures for ${onestopId}`)
        allDepartures.push(...departures)
      } else {
        console.debug(`🚫 [Widget/Transit] No departures for ${onestopId}`)
      }
    } catch (error) {
      console.error(`❌ [Widget/Transit] Error fetching departures for ${onestopId}:`, error)
    }
  }

  // Sort by departure time
  allDepartures.sort((a, b) => {
    const timeA = a.departureTime || a.arrivalTime || ''
    const timeB = b.departureTime || b.arrivalTime || ''
    return timeA.localeCompare(timeB)
  })

  const sources: SourceReference[] = allDepartures.length > 0
    ? [{
        id: SOURCE.TRANSITLAND,
        name: 'Transitland',
        url: `https://www.transit.land/stops/${onestopIds[0]}`,
      }]
    : []

  return { departures: allDepartures, sources }
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
      const onestopIds = (params.onestopIds || '').split(',').filter(Boolean)
      const next = params.next ? parseInt(params.next, 10) : undefined
      const limit = params.limit ? parseInt(params.limit, 10) : undefined

      if (!onestopIds.length) {
        throw new Error('Missing onestopIds parameter for transit widget')
      }

      const { departures, sources } = await fetchTransitDepartures(onestopIds, { next, limit })

      const transitInfo: TransitStopInfo = {
        onestopId: onestopIds[0],
        onestopIds: onestopIds.length > 1 ? onestopIds : undefined,
        departures,
      }

      return {
        type: WidgetType.TRANSIT,
        data: {
          value: transitInfo,
          sourceId: SOURCE.TRANSITLAND,
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
  if (!osmId) return []

  // Try Barrelman first for spatial contains queries
  if (lat && lng) {
    const barrelman = getBarrelmanContainsInstance()
    if (barrelman) {
      try {
        console.debug(`🌐 [Widget/Parent] Finding containers via Barrelman for (${lat},${lng})`)
        const containers = await barrelman.getContainingAreas(lat, lng, osmId)
        if (containers.length) {
          // Filter self-references: c.id is "osm/way/123", osmId is "way/123"
          const nonSelf = containers.filter((c) => {
            const cOsmId = c.externalIds?.[SOURCE.OSM] || ''
            return cOsmId !== osmId && c.id !== osmId && c.id !== `osm/${osmId}`
          })
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
