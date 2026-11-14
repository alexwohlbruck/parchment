import {
  SearchResult,
  SearchOptions,
  SearchResponse,
  AutocompleteResult,
  AutocompleteResponse,
} from '../types/search.types'
import { Bookmark } from '../types/library.types'
import { Place } from '../types/place.types'
import type { Language } from '../lib/i18n/i18n.types'
// Import existing services
import { searchBookmarks as searchBookmarksService } from './library/bookmarks.service'
import { lookupPlacesByNameAndLocation } from './place.service'
import { categoryService } from './category.service'
import {
  IntegrationCapabilityId,
  IntegrationId,
  MapBounds,
  type BrandSummary,
} from '../types/integration.types'
import { integrationManager } from './integrations'
import { getBrandSuggestions } from './brand.service'
import { resolvePresetIcon } from '../lib/place-categories'
import { getPlaceGroup } from '../lib/place-groups'
import { isDestination, isPlacePermanentlyClosed } from '../lib/place-tags'
import { resolveCoordinateQuery } from './coordinate-search.service'

/**
 * Relevance subtracted from a permanently closed place, large enough to drop it
 * below the whole live-place band (which spans 0.9 down) regardless of rank.
 */
const PERMANENTLY_CLOSED_PENALTY = 1


/**
 * Convert a CategoryResult/preset to a SearchResult
 */
function convertPresetToSearchResult(preset: any): SearchResult {
  // Resolve preset icon (usually maki-prefixed) to icon name + pack, falling
  // back through the preset's own family rather than to a pin.
  const resolvedIcon = resolvePresetIcon(preset.id, preset.icon)

  return {
    id: preset.id,
    type: 'category',
    title: preset.name,
    // Only use the description if it's human-readable — raw OSM tag fallbacks
    // like "amenity=library" (key=value, no spaces) are not useful to show.
    description: preset.description && !/^\S+=\S+$/.test(preset.description)
      ? preset.description
      : undefined,
    icon: resolvedIcon.icon,
    iconPack: resolvedIcon.iconPack,
    iconCategory: preset.iconCategory,
    metadata: {
      category: {
        tags: preset.tags,
        addTags: preset.addTags,
        geometry: preset.geometry,
      },
    },
  }
}

/** A house number followed by a word: "350 5th Ave", "12b Elm St". */
const ADDRESS_QUERY = /^\s*\d+[a-z]?\s+\S/i
/** A name ending in a street type: "Elm Street", "Michigan Ave". */
const STREET_QUERY =
  /\S\s+(st|street|av|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|ct|court|pl|place|pkwy|parkway|hwy|highway|way|cir|circle|ter|terrace)\.?\s*$/i

/** Relevance of a partial brand match when a place is named exactly what was
 *  typed: below the first five places (0.90 down to 0.82). */
const BRAND_BELOW_NAMED_PLACE = 0.8

/** Normalize a brand/query string for exact-match comparison. */
function normalizeBrandText(s: string): string {
  return s.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
}

/**
 * Convert a brand catalog row to a SearchResult ("See all McDonald's
 * locations"). The client renders the "See all locations" label + count; we
 * carry the brand key + representative location for navigation.
 */
function convertBrandToSearchResult(brand: BrandSummary): SearchResult {
  return {
    id: brand.brandKey,
    type: 'brand',
    title: brand.name,
    icon: 'Store',
    iconPack: 'lucide',
    metadata: {
      brand: {
        brandKey: brand.brandKey,
        name: brand.name,
        wikidata: brand.wikidata ?? undefined,
        locationCount: brand.locationCount,
        category: brand.category ?? undefined,
        logoUrl: brand.logoUrl ?? undefined,
        lat: brand.repLat ?? undefined,
        lng: brand.repLng ?? undefined,
      },
    },
  }
}

/**
 * Convert a full SearchResult to a lightweight AutocompleteResult
 */
function convertToAutocompleteResult(result: SearchResult): AutocompleteResult {
  // Extract coordinates from metadata based on result type
  let lat: number | undefined, lng: number | undefined
  let category: AutocompleteResult['category'] | undefined
  let brand: AutocompleteResult['brand'] | undefined

  if (result.type === 'bookmark' && result.metadata.bookmark) {
    lat = result.metadata.bookmark.lat
    lng = result.metadata.bookmark.lng
  } else if (result.type === 'place' && result.metadata.place) {
    lat = result.metadata.place.geometry.value.center.lat
    lng = result.metadata.place.geometry.value.center.lng
  } else if (result.type === 'category' && result.metadata.category) {
    // Categories don't have coordinates, but include category metadata
    category = result.metadata.category
  } else if (result.type === 'brand' && result.metadata.brand) {
    brand = result.metadata.brand
    lat = result.metadata.brand.lat
    lng = result.metadata.brand.lng
  } else if (
    (result.type === 'transit_route' || result.type === 'transit_stop') &&
    result.metadata.place
  ) {
    lat = result.metadata.place.geometry.value.center.lat
    lng = result.metadata.place.geometry.value.center.lng
  }

  return {
    id: result.id,
    type: result.type,
    title: result.title,
    description: result.description,
    icon: result.icon,
    iconPack: result.iconPack,
    iconCategory: result.iconCategory,
    color: result.color,
    lat,
    lng,
    category,
    brand,
    transitLine: result.metadata.transitLine,
    transitStop: result.metadata.transitStop,
  }
}

/**
 * Convert a bookmark to a search result
 */
function convertBookmarkToSearchResult(bookmark: Bookmark): SearchResult {
  const presetIcons: Record<string, string> = {
    home: 'Home',
    work: 'Building',
    school: 'GraduationCap',
  }

  // Type guard for preset type
  const validFrequentType =
    bookmark.frequentType &&
    ['home', 'work', 'school'].includes(bookmark.frequentType)
      ? (bookmark.frequentType as 'home' | 'work' | 'school')
      : undefined

  // Determine description based on preset type
  let description: string | undefined
  if (validFrequentType) {
    // For preset bookmarks, use the preset type as description (capitalized)
    description =
      validFrequentType.charAt(0).toUpperCase() + validFrequentType.slice(1)
  } else {
    // For non-preset bookmarks, use "Bookmarked • street address" format
    // TODO: i18n
    if (bookmark.address) {
      description = `Bookmarked • ${bookmark.address}`
    } else {
      description = 'Bookmarked'
    }
  }

  return {
    id: bookmark.id,
    type: 'bookmark',
    title: bookmark.name,
    description: description,
    icon: validFrequentType
      ? presetIcons[validFrequentType] || bookmark.icon
      : bookmark.icon,
    color: bookmark.iconColor,
    metadata: {
      bookmark: {
        id: bookmark.id,
        // Pass the raw type through so `custom` frequents aren't dropped;
        // only canonical types (home/work/school) get a fixed icon above.
        frequentType: (bookmark.frequentType || undefined) as
          | 'home'
          | 'work'
          | 'school'
          | 'custom'
          | undefined,
        iconColor: bookmark.iconColor,
        address: bookmark.address || undefined,
        lat: bookmark.lat,
        lng: bookmark.lng,
        externalIds: bookmark.externalIds as Record<string, string>,
      },
    },
  }
}

/**
 * Convert a Place object to a SearchResult
 */
function convertPlaceToSearchResult(place: Place): SearchResult {
  // A GTFS line or GTFS-only stop riding the place pipeline: type it so the
  // client opens the transit views instead of the place detail view.
  if (place.transitLine || place.transitStop) {
    const line = place.transitLine
    const name = place.name?.value
    const title = line?.shortName && name && line.shortName !== name
      ? `${line.shortName} · ${name}`
      : name || line?.shortName || 'Transit'
    return {
      id: place.id,
      type: line ? 'transit_route' : 'transit_stop',
      title,
      description: place.summary || place.placeType?.value,
      icon: place.icon?.icon || 'TrainFront',
      iconPack: place.icon?.iconPack,
      metadata: {
        place,
        transitLine: line ?? undefined,
        transitStop: place.transitStop ?? undefined,
      },
    }
  }

  const placeType = place.placeType?.value || ''

  // For places, use street address as description if we have both name and address
  // This helps distinguish between place names and address lookups
  let address = ''

  if (place.address?.value) {
    // Use formatted address if available
    if (place.address.value.formatted) {
      address = place.address.value.formatted
    } else {
      // Build formatted address from components (for Pelias results)
      const addr = place.address.value
      const parts = []

      if (addr.street1) parts.push(addr.street1)
      if (addr.locality) parts.push(addr.locality)
      if (addr.region && addr.postalCode) {
        parts.push(`${addr.region} ${addr.postalCode}`)
      } else if (addr.region) {
        parts.push(addr.region)
      } else if (addr.postalCode) {
        parts.push(addr.postalCode)
      }
      if (addr.country) parts.push(addr.country)

      address = parts.join(', ')
    }
  }

  const description = placeType && address
    ? `${placeType} · ${address}`
    : placeType || address

  return {
    id: place.id,
    type: 'place',
    title: place.name?.value || 'Unknown Place',
    description,
    icon: place.icon?.icon || 'MapPin',
    iconPack: place.icon?.iconPack,
    iconCategory: place.icon?.category,
    metadata: {
      place: place,
    },
  }
}

/**
 * Main search function that combines all sources
 */
export async function search(
  userId: string,
  options: SearchOptions,
  language: Language = 'en-US',
  signal?: AbortSignal,
): Promise<SearchResponse | AutocompleteResponse> {
  const {
    query,
    lat,
    lng,
    radius = 10000,
    maxResults = 50,
    autocomplete = false,
  } = options

  // Collect all results with normalized relevance scores (0-1) for interleaving
  const scoredResults: Array<{ result: SearchResult; relevance: number }> = []

  // A query naming a point (coordinates, a plus code, a what3words address)
  // gets a synthetic result for that point, ahead of everything else.
  if (query) {
    const reference = lat != null && lng != null ? { lat, lng } : undefined
    const coords = await resolveCoordinateQuery(query, reference)
    if (coords) {
      const coordId = `coords/${coords.lat}/${coords.lng}`
      const timestamp = new Date().toISOString()
      scoredResults.push({
        result: {
          id: coordId,
          type: 'place',
          title: coords.title,
          description: coords.description,
          icon: 'MapPin',
          iconPack: 'lucide',
          metadata: {
            place: {
              id: coordId,
              externalIds: {},
              name: { value: coords.title, sourceId: 'input', timestamp },
              description: null,
              placeType: { value: coords.kind, sourceId: 'input', timestamp },
              icon: { icon: 'MapPin', iconPack: 'lucide' as const },
              geometry: {
                value: {
                  type: 'point',
                  center: { lat: coords.lat, lng: coords.lng },
                },
                sourceId: 'input',
                timestamp,
              },
              photos: [],
              address: null,
              contactInfo: { phone: null, email: null, website: null, websites: null, socials: {} },
              openingHours: null,
              amenities: {},
              tags: {},
              summary: null,
              sources: [],
              lastUpdated: timestamp,
              createdAt: timestamp,
            } as any,
          },
        },
        relevance: 1.0,
      })
    }
  }

  // Search presets/categories (only for 1+ character queries)
  if (query && query.length > 0) {
    const scoredPresets = categoryService.searchCategoriesWithScores(
      query,
      language,
      Math.min(5, maxResults),
    )
    for (const { category, score } of scoredPresets) {
      // Normalize category score to 0-1 range (max raw score ~1050)
      const relevance = Math.min(score / 1000, 1)
      scoredResults.push({
        result: convertPresetToSearchResult(category),
        relevance,
      })
    }
  }

  // Recents (searches + viewed places) are client-side and end-to-end
  // encrypted, so the server can't surface them here — see web/src/lib/recents.

  // Bookmarks, external place lookup, and brand suggestions are independent —
  // run them concurrently so no one leg's latency delays the others.
  const [userBookmarks, places, brands] = await Promise.all([
    searchBookmarksService(userId, query),
    // External places via place service (only for 1+ character queries)
    query && query.length > 0 && lat && lng
      ? lookupPlacesByNameAndLocation(
          query,
          { lat, lng },
          {
            radius,
            autocomplete,
            userId,
            language,
            signal,
          },
        )
      : Promise.resolve([]),
    // Brand suggestions from the catalog (gated ≥2 chars; empty if unavailable)
    query && query.trim().length >= 2
      ? getBrandSuggestions(query, 3)
      : Promise.resolve([] as BrandSummary[]),
  ])

  for (let i = 0; i < userBookmarks.length; i++) {
    // Bookmarks are pre-sorted by relevance; assign decreasing score
    scoredResults.push({
      result: convertBookmarkToSearchResult(userBookmarks[i]),
      relevance: 1.0 - i * 0.05,
    })
  }

  for (let i = 0; i < places.length; i++) {
    // Places are pre-sorted by relevance from the integration;
    // assign decreasing score starting at 0.9 (slightly below exact category match)
    const relevance = 0.9 - i * 0.02

    // Permanently closed places stay searchable — someone looking for a place
    // that shut down still wants to find out that it shut down — but they sort
    // below everything still trading, so they never take a top slot.
    scoredResults.push({
      result: convertPlaceToSearchResult(places[i]),
      relevance: isPlacePermanentlyClosed(places[i])
        ? relevance - PERMANENTLY_CLOSED_PENALTY
        : relevance,
    })
  }

  // Brand suggestions: an exact-name brand pins above the individual locations
  // (places top out at 0.9); a fuzzy brand match sits just alongside them,
  // except under a street or address, where it only pushes those results down.
  //
  // When a place is named exactly what was typed, that place is what the user
  // means, and a brand that only starts with the same word comes after the
  // first few places instead: "austin" put Austin Bank (4 locations) second,
  // under the city, and "portland" did the same with Portland Glass.
  if (brands.length > 0) {
    const qNorm = normalizeBrandText(query || '')
    const streetQuery = ADDRESS_QUERY.test(query || '') || STREET_QUERY.test(query || '')
    const placeNamedAsTyped = scoredResults.some(
      (s) => s.result.type === 'place' && normalizeBrandText(s.result.title || '') === qNorm,
    )
    for (let i = 0; i < brands.length; i++) {
      const exact = normalizeBrandText(brands[i].name) === qNorm
      if (!exact && streetQuery) continue
      scoredResults.push({
        result: convertBrandToSearchResult(brands[i]),
        relevance: exact
          ? 0.97
          : (placeNamedAsTyped ? BRAND_BELOW_NAMED_PLACE : 0.9) - i * 0.02,
      })
    }
  }

  // Sort all results by relevance (descending) to interleave types naturally
  scoredResults.sort((a, b) => b.relevance - a.relevance)

  const allResults = scoredResults.map((s) => s.result)

  // Apply result limit
  const limitedResults = allResults.slice(0, maxResults)

  // Return autocomplete format if requested
  if (autocomplete) {
    const autocompleteResults = limitedResults.map(convertToAutocompleteResult)
    return {
      query,
      results: autocompleteResults,
      totalCount: allResults.length,
    } as AutocompleteResponse
  }

  // Return full format
  return {
    query,
    results: limitedResults,
    totalCount: allResults.length,
  } as SearchResponse
}

/**
 * Get category details by ID
 */

export interface CategorySearchOptions {
  bounds: MapBounds
  limit?: number
  offset?: number
  sort?: 'relevance' | 'distance' | 'name'
  filter?: {
    access?: string[]
    fee?: 'yes' | 'no'
    hasHours?: boolean
  }
  tags?: Record<string, string>
}

/**
 * OSM tag keys Barrelman turns into `geo_places.categories` entries — mirrors
 * POI_KEYS in its `import/osm2pgsql-flex.lua`. A preset keyed on anything else
 * describes an attribute a place *has* rather than a kind of place, so it can
 * only be searched as a tag filter.
 */
const CATEGORY_TAG_KEYS = new Set([
  'amenity', 'shop', 'tourism', 'leisure', 'office', 'craft',
  'healthcare', 'social_facility', 'historic', 'man_made',
  'aeroway', 'public_transport', 'emergency', 'place',
  'building', 'natural', 'landuse', 'waterway', 'power',
  'railway', 'highway', 'barrier', 'entrance', 'playground',
  'club', 'gambling', 'advertising', 'cuisine',
])

interface PresetFilter {
  /** Barrelman categories a place may have any one of; empty browses on tags alone. */
  categoryIds: string[]
  filterTags: Record<string, string>
}

/**
 * The barrelman category and extra tag filters for one set of preset tags.
 * Barrelman files a place under `key/value` for each of its primary tags, so
 * `amenity/restaurant/pizza` (`amenity=restaurant`, `cuisine=pizza`) browses
 * `amenity/restaurant` filtered on `cuisine=pizza`. The preset id's own key
 * wins when the tags hold several primary keys.
 *
 * Tags with no primary key (`internet_access=wlan`) describe something a place
 * has rather than is, and browse on tags alone.
 */
function derivePresetFilter(
  presetId: string,
  presetTags: Record<string, string>,
): PresetFilter {
  // Wildcards can't be matched by JSONB containment.
  const concrete = Object.fromEntries(
    Object.entries(presetTags).filter(([, value]) => value !== '*'),
  )
  const idKey = presetId.split('/')[0]
  const key = CATEGORY_TAG_KEYS.has(idKey) && idKey in concrete
    ? idKey
    : Object.keys(concrete).find((k) => CATEGORY_TAG_KEYS.has(k))

  if (key) {
    const { [key]: value, ...filterTags } = concrete
    return { categoryIds: [`${key}/${value}`], filterTags }
  }
  if (Object.keys(concrete).length > 0) return { categoryIds: [], filterTags: concrete }
  return { categoryIds: presetId ? [presetId] : [], filterTags: {} }
}

/**
 * One filter per way a place can match the preset. Most presets have one; a
 * preset with `tagSets` (outdoor seating: `yes`, `garden`, `terrace`, …) has
 * one per set, since barrelman's tag filter is exact containment. A group
 * gathers its members' filters.
 */
function derivePresetFilters(presetId: string): PresetFilter[] {
  const group = getPlaceGroup(presetId)
  if (group) {
    return group.members.flatMap((member) =>
      typeof member === 'string'
        ? derivePresetFilters(member)
        : [derivePresetFilter('', member)],
    )
  }
  const preset = categoryService.getCategoryById(presetId)
  const tagSets = preset?.tagSets?.length
    ? preset.tagSets
    : [(preset?.tags || {}) as Record<string, string>]
  return tagSets.map((tags) => derivePresetFilter(presetId, tags))
}

/**
 * Folds filters with the same tag filter into one request: barrelman matches a
 * place in any of the listed categories, so benches and picnic tables share a
 * browse. Tag-only filters match any category and stay on their own.
 */
export function combinePresetFilters(filters: PresetFilter[]): PresetFilter[] {
  const combined = new Map<string, PresetFilter>()
  for (const filter of filters) {
    const tags = Object.entries(filter.filterTags).sort(([a], [b]) => a.localeCompare(b))
    const key = JSON.stringify([filter.categoryIds.length > 0, tags])
    const existing = combined.get(key)
    if (!existing) {
      combined.set(key, { categoryIds: [...filter.categoryIds], filterTags: filter.filterTags })
      continue
    }
    for (const id of filter.categoryIds) {
      if (!existing.categoryIds.includes(id)) existing.categoryIds.push(id)
    }
  }
  return [...combined.values()]
}

/** The browse requests one page of `presetId` fans out to, before any widening. */
export function presetBrowseFilters(presetId: string): PresetFilter[] {
  return combinePresetFilters(derivePresetFilters(presetId))
}

function distanceToCenter(place: Place, bounds: MapBounds): number {
  const center = place.geometry?.value?.center
  if (!center) return Infinity
  const midLat = (bounds.north + bounds.south) / 2
  const midLng = (bounds.east + bounds.west) / 2
  const dLng = (center.lng - midLng) * Math.cos((midLat * Math.PI) / 180)
  return Math.hypot(center.lat - midLat, dLng)
}

/** Nearest-first union of per-filter result lists, each a place once. */
function mergeNearest(lists: Place[][], bounds: MapBounds): Place[] {
  const byId = new Map<string, Place>()
  for (const place of lists.flat()) {
    if (!byId.has(place.id)) byId.set(place.id, place)
  }
  return [...byId.values()].sort(
    (a, b) => distanceToCenter(a, bounds) - distanceToCenter(b, bounds),
  )
}

/**
 * Search by category/preset using available integrations
 */
export async function searchByCategory(
  presetId: string,
  options: CategorySearchOptions,
): Promise<Place[]> {
  if (!presetId) {
    return []
  }

  const integrationRecords = integrationManager.getConfiguredIntegrationsByCapability(
    IntegrationCapabilityId.SEARCH_CATEGORY,
  )

  const preferredIntegration = integrationRecords[0]

  if (!preferredIntegration) {
    return [] // TODO: Return useful error to client
  }

  const integration =
    integrationManager.getCachedIntegrationInstance(preferredIntegration)

  if (!integration) {
    return [] // TODO: Return useful error to client
  }

  const searchCapability = integration.capabilities.searchCategory

  if (!searchCapability?.searchByCategory) {
    throw new Error(
      `Integration ${integration.integrationId} does not support category search`,
    )
  }

  const filters = presetBrowseFilters(presetId)

  const run = ({ categoryIds, filterTags }: PresetFilter, limit?: number, offset?: number) => {
    const mergedTags = { ...filterTags, ...options.tags }
    return searchCapability.searchByCategory(categoryIds, options.bounds, {
      limit,
      offset,
      filterTags: Object.keys(mergedTags).length > 0 ? mergedTags : undefined,
      sort: options.sort,
      filter: options.filter,
    })
  }

  const tagOnly = filters.some((filter) => !filter.categoryIds.length)
  if (filters.length === 1 && !tagOnly) {
    return run(filters[0], options.limit, options.offset)
  }

  // No filter's own page lines up with the merged one, so each fetches up to
  // the end of the requested page. A tag-only browse also brings back roads and
  // platforms that get dropped, so it fetches twice that.
  const limit = options.limit ?? 20
  const offset = options.offset ?? 0
  const fetchCount = (offset + limit) * (tagOnly ? 2 : 1)
  const lists = await Promise.all(filters.map(async (filter) => {
    const places = await run(filter, fetchCount, 0)
    return filter.categoryIds.length ? places : places.filter(isDestination)
  }))
  return mergeNearest(lists, options.bounds).slice(offset, offset + limit)
}

/**
 * Search along a route corridor using available integrations
 */
export interface RouteSearchOptions {
  query?: string
  buffer?: number
  categories?: string[]
  tags?: Record<string, string>
  limit?: number
  semantic?: boolean
  autocomplete?: boolean
}

export async function searchAlongRoute(
  route: { type: 'LineString'; coordinates: number[][] },
  options: RouteSearchOptions = {},
): Promise<Place[]> {
  const integrationRecords =
    integrationManager.getConfiguredIntegrationsByCapability(
      IntegrationCapabilityId.SEARCH_ALONG_ROUTE,
    )

  const preferredIntegration = integrationRecords[0]
  if (!preferredIntegration) return []

  const integration =
    integrationManager.getCachedIntegrationInstance(preferredIntegration)
  if (!integration) return []

  const capability = integration.capabilities.searchAlongRoute
  if (!capability?.searchAlongRoute) {
    throw new Error(
      `Integration ${integration.integrationId} does not support route search`,
    )
  }

  return await capability.searchAlongRoute(route, options)
}
