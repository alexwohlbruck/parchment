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
import { resolveIcon } from '../lib/place-categories'


function parseCoordinateQuery(query: string): { lat: number; lng: number } | null {
  const trimmed = query.trim()

  // "35.2271, -80.8431" or "35.2271,-80.8431"
  const commaMatch = trimmed.match(/^(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/)
  if (commaMatch) {
    return validateAndNormalizeCoords(parseFloat(commaMatch[1]), parseFloat(commaMatch[2]))
  }

  // "35.2271 -80.8431" (both must have decimals to avoid "123 Main" false positives)
  const spaceMatch = trimmed.match(/^(-?\d{1,3}\.\d+)\s+(-?\d{1,3}\.\d+)$/)
  if (spaceMatch) {
    return validateAndNormalizeCoords(parseFloat(spaceMatch[1]), parseFloat(spaceMatch[2]))
  }

  // "35.2271N 80.8431W" or "35.2271N, 80.8431W"
  const nsewMatch = trimmed.match(/^(\d{1,3}(?:\.\d+)?)\s*([NSns])\s*,?\s*(\d{1,3}(?:\.\d+)?)\s*([EWew])$/)
  if (nsewMatch) {
    let lat = parseFloat(nsewMatch[1])
    let lng = parseFloat(nsewMatch[3])
    if (/[Ss]/.test(nsewMatch[2])) lat = -lat
    if (/[Ww]/.test(nsewMatch[4])) lng = -lng
    return validateAndNormalizeCoords(lat, lng)
  }

  return null
}

function validateAndNormalizeCoords(a: number, b: number): { lat: number; lng: number } | null {
  if (!isFinite(a) || !isFinite(b)) return null

  if (Math.abs(a) <= 90 && Math.abs(b) <= 180) {
    return { lat: a, lng: b }
  }

  // Auto-swap if user entered lng,lat order
  if (Math.abs(b) <= 90 && Math.abs(a) <= 180) {
    return { lat: b, lng: a }
  }

  return null
}

/**
 * Convert a CategoryResult/preset to a SearchResult
 */
function convertPresetToSearchResult(preset: any): SearchResult {
  // Resolve preset icon (usually maki-prefixed) to icon name + pack
  const resolvedIcon = resolveIcon(preset.icon || 'maki-marker')

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

  // Coordinate detection — inject synthetic result if query looks like coordinates
  if (query) {
    const coords = parseCoordinateQuery(query)
    if (coords) {
      const coordId = `coords/${coords.lat}/${coords.lng}`
      const timestamp = new Date().toISOString()
      scoredResults.push({
        result: {
          id: coordId,
          type: 'place',
          title: `${coords.lat}, ${coords.lng}`,
          description: 'Coordinates',
          icon: 'MapPin',
          iconPack: 'lucide',
          metadata: {
            place: {
              id: coordId,
              externalIds: {},
              name: { value: `${coords.lat}, ${coords.lng}`, sourceId: 'input', timestamp },
              description: null,
              placeType: { value: 'Coordinates', sourceId: 'input', timestamp },
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
    scoredResults.push({
      result: convertPlaceToSearchResult(places[i]),
      relevance: 0.9 - i * 0.02,
    })
  }

  // Brand suggestions: an exact-name brand pins above the individual locations
  // (places top out at 0.9); a fuzzy brand match sits just alongside them.
  if (brands.length > 0) {
    const qNorm = normalizeBrandText(query || '')
    for (let i = 0; i < brands.length; i++) {
      const exact = normalizeBrandText(brands[i].name) === qNorm
      scoredResults.push({
        result: convertBrandToSearchResult(brands[i]),
        relevance: exact ? 0.97 : 0.9 - i * 0.02,
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
  sort?: 'relevance' | 'distance' | 'name'
  filter?: {
    access?: string[]
    fee?: 'yes' | 'no'
    hasHours?: boolean
  }
  tags?: Record<string, string>
}

/**
 * Derive the primary Barrelman category and extra OSM tag filters from a preset ID.
 *
 * The iD tagging schema uses hierarchical preset IDs like `amenity/restaurant/pizza`
 * where the full tags are `{amenity:"restaurant", cuisine:"pizza"}`. Barrelman's DB only
 * stores the primary category (`amenity/restaurant`), so we must:
 *   1. Send the parent preset ID as the category filter
 *   2. Pass the additional discriminating tags (cuisine=pizza) as a secondary filter
 */
function derivePresetFilter(presetId: string): {
  categoryId: string
  filterTags: Record<string, string>
} {
  const preset = categoryService.getCategoryById(presetId)
  const presetTags = (preset?.tags || {}) as Record<string, string>

  const parts = presetId.split('/')
  if (parts.length <= 2) {
    // Top-level preset (e.g. amenity/restaurant) — no extra filtering needed
    return { categoryId: presetId, filterTags: {} }
  }

  // Sub-preset (e.g. amenity/restaurant/pizza): derive extra tags by diffing against parent
  const parentId = `${parts[0]}/${parts[1]}`
  const parentPreset = categoryService.getCategoryById(parentId)
  const parentTags = (parentPreset?.tags || {}) as Record<string, string>

  // Filter tags = tags the sub-preset adds beyond the parent (e.g. cuisine=pizza)
  const filterTags: Record<string, string> = {}
  for (const [key, value] of Object.entries(presetTags)) {
    if (parentTags[key] !== value) {
      filterTags[key] = value
    }
  }

  return { categoryId: parentId, filterTags }
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

  // Resolve sub-preset IDs to parent category + filter tags
  const { categoryId, filterTags } = derivePresetFilter(presetId)

  const mergedTags = { ...filterTags, ...options.tags }

  return await searchCapability.searchByCategory(categoryId, options.bounds, {
    limit: options.limit,
    filterTags: Object.keys(mergedTags).length > 0 ? mergedTags : undefined,
    sort: options.sort,
    filter: options.filter,
  })
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
