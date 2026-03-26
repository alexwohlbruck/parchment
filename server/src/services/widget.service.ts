import type { Place, TransitDeparture, TransitStopInfo, WidgetDescriptor, WidgetResponse, SourceReference, RelatedPlacesData, RelatedPlacesStrategy, RelatedParent } from '../types/place.types'
import { WidgetType } from '../types/place.types'
import { SOURCE } from '../lib/constants'
import { integrationManager } from './integrations'
import { IntegrationCapabilityId } from '../types/integration.types'
import { TransitlandIntegration } from './integrations/transitland-integration'
import { OverpassIntegration } from './integrations/overpass-integration'
import { matchTags } from '../lib/osm-presets'
import { buildPlaceIcon } from '../lib/place-categories'
import * as turf from '@turf/turf'

/**
 * Inspect a place and return the list of widget descriptors that apply.
 * These descriptors tell the client which widgets to render and what
 * params to pass when fetching widget data.
 */
export function resolveWidgetDescriptors(place: Place): WidgetDescriptor[] {
  const descriptors: WidgetDescriptor[] = []

  // Transit widget: applicable if place has transit stop info with an onestop ID
  if (place.transit?.value?.onestopId) {
    const transit = place.transit.value
    const onestopIds = transit.onestopIds || [transit.onestopId]

    descriptors.push({
      type: WidgetType.TRANSIT,
      title: transit.name || 'Transit Departures',
      estimatedHeight: 200,
      params: {
        onestopIds: onestopIds.join(','),
      },
    })
  }

  // Related Places widget
  {
    const osmId = place.externalIds?.[SOURCE.OSM]
    const osmType = osmId?.split('/')[0]
    const center = place.geometry?.value?.center
    const bounds = place.geometry?.value?.bounds
    const placeTypeLower = place.placeType?.value?.toLowerCase() || ''

    const isAreaPlace = osmType === 'way' || osmType === 'relation'
    const adminTypes = ['city', 'town', 'village', 'suburb', 'neighbourhood', 'borough', 'county', 'state', 'country']
    const isAdminPlace = adminTypes.includes(placeTypeLower)

    // A "container" is an area place with defined nearby categories (i.e. we know what to look for inside it)
    const isContainerPlace = isAreaPlace && !isAdminPlace && Boolean(place.nearbyCategories?.length)

    if (isAdminPlace && osmId && center) {
      // Admin strategy: show next-level-up administrative boundary
      descriptors.push({
        type: WidgetType.RELATED_PLACES,
        title: 'Related Places',
        estimatedHeight: 100,
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
    } else if (osmId && center) {
      // Non-admin places can show BOTH children and parent simultaneously.
      // e.g. a food hall inside a university shows "Inside: [restaurants]" AND "Located in: [university]"

      if (isContainerPlace) {
        // Children strategy: show interesting POIs inside this area
        descriptors.push({
          type: WidgetType.RELATED_PLACES,
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
          },
        })
      }

      // Parent strategy: show the containing area for any non-admin place
      // (works for nodes AND area features like playgrounds, food halls, parks, etc.)
      descriptors.push({
        type: WidgetType.RELATED_PLACES,
        title: 'Related Places',
        estimatedHeight: 100,
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

  if (!transitlandRecord) {
    console.debug('🚫 [Widget/Transit] Transitland integration not configured')
    return { departures: [], sources: [] }
  }

  const transitland = integrationManager.getCachedIntegrationInstance(transitlandRecord) as TransitlandIntegration
  if (!transitland) {
    console.debug('🚫 [Widget/Transit] Transitland integration instance not found')
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

  switch (strategy) {
    case 'children':
      children = await fetchChildrenInArea(osmId, presetIds, placeId, lat, lng, bbox)
      break
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
      value: { strategy, children, parents, centerLat: lat, centerLng: lng },
      sourceId: SOURCE.OSM,
      timestamp: new Date().toISOString(),
    },
    sources: (children.length || parents.length)
      ? [{ id: SOURCE.OSM, name: 'OpenStreetMap', url: 'https://www.openstreetmap.org' }]
      : [],
  }
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
): Promise<Place[]> {
  const overpassRecord = integrationManager.getConfiguredIntegrationsByCapability(
    IntegrationCapabilityId.SEARCH_CATEGORY,
  ).find((r) => r.integrationId === 'overpass')

  if (!overpassRecord) {
    console.debug('🚫 [Widget/RelatedPlaces] Overpass integration not configured')
    return []
  }

  const overpass = integrationManager.getCachedIntegrationInstance(overpassRecord) as OverpassIntegration
  if (!overpass) {
    console.debug('🚫 [Widget/RelatedPlaces] Overpass integration instance not found')
    return []
  }

  console.debug(`🌐 [Widget/RelatedPlaces] Fetching children in ${osmId} for ${presetIds.length} categories (bbox: ${bbox ? 'yes' : 'no'})`)
  const places = await overpass.searchByCategoryInArea(osmId, presetIds, { limit: 50, bbox })

  // Exclude the parent place itself
  const withoutSelf = places.filter((p) => p.id !== excludePlaceId)

  // Unnamed instances of these types are too granular to be useful on their own
  const REQUIRE_NAME = new Set([
    'bench', 'picnic_table', 'waste_basket', 'waste_bin', 'recycling',
    'bollard', 'fire_hydrant', 'street_lamp', 'manhole', 'post_box',
    'information', 'guidepost', 'advertising', 'vending_machine',
  ])

  const centerPoint = turf.point([centerLng, centerLat])
  const scored = withoutSelf
    .filter((p) => {
      const hasName = Boolean(p.name?.value)
      if (hasName) return true

      const addr = p.address?.value
      const hasAddress = Boolean(addr?.street || addr?.housenumber || addr?.full)
      if (hasAddress) return true

      // Unnamed with no address: only hide if it's a granular/noisy type
      const typeRaw = (p.placeType?.value || '').toLowerCase().replace(/\s+/g, '_')
      return !REQUIRE_NAME.has(typeRaw)
    })
    .map((p) => {
      const hasName = Boolean(p.name?.value)
      const addr = p.address?.value
      const hasAddress = Boolean(addr?.street || addr?.housenumber || addr?.full)
      // Relevance: named+addressed > named > addressed > unnamed
      const relevance = (hasName ? 2 : 0) + (hasAddress ? 1 : 0)

      const placeCenter = p.geometry?.value?.center
      const dist = placeCenter
        ? turf.distance(centerPoint, turf.point([placeCenter.lng, placeCenter.lat]), { units: 'meters' })
        : Infinity

      return { place: p, relevance, dist }
    })

  // Sort: highest relevance first, then closest
  scored.sort((a, b) => b.relevance - a.relevance || a.dist - b.dist)

  // For unnamed amenity-type items (parking racks, fountains, etc.), cap at 2 per type
  // to avoid e.g. 7 identical "Bicycle Parking" entries. But structural types like
  // buildings are all distinct physical places and should all be shown.
  const STRUCTURAL_TYPES = new Set([
    'apartment building', 'apartment complex', 'building', 'residential building',
    'commercial building', 'office building', 'dormitory',
  ])
  const typeCount = new Map<string, number>()
  const MAX_UNNAMED_AMENITY_PER_TYPE = 2

  const deduped = scored.filter(({ place, relevance }) => {
    if (relevance > 0) return true // named/addressed — always keep
    const typeKey = (place.placeType?.value || '').toLowerCase()
    if (STRUCTURAL_TYPES.has(typeKey)) return true // buildings always shown
    const count = typeCount.get(typeKey) || 0
    if (count >= MAX_UNNAMED_AMENITY_PER_TYPE) return false
    typeCount.set(typeKey, count + 1)
    return true
  })

  return deduped.slice(0, 20).map((s) => s.place)
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

  if (!adminOnly) {
    // Parent strategy: use Overpass is_in for spatial containment
    const overpassRecord = integrationManager.getConfiguredIntegrationsByCapability(
      IntegrationCapabilityId.SEARCH_CATEGORY,
    ).find((r) => r.integrationId === 'overpass')

    if (overpassRecord) {
      const overpass = integrationManager.getCachedIntegrationInstance(overpassRecord) as OverpassIntegration
      if (overpass && lat && lng) {
        try {
          console.debug(`🌐 [Widget/Parent] Finding containers for (${lat},${lng}) via is_in`)
          const containers = await overpass.findContainingAreas(lat, lng)
          if (containers.length) {
            // Filter out self-reference (is_in includes the element itself if it's an area)
            const nonSelf = containers.filter((c) => c.id !== osmId)
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
