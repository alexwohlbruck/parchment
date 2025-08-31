import {
  SearchResult,
  SearchOptions,
  SearchResponse,
  AutocompleteResult,
  AutocompleteResponse,
} from '../types/search.types'
import { Bookmark } from '../types/library.types'
import { Place } from '../types/place.types'
import type { SupportedLanguage } from '../lib/i18n'
// Import existing services
import { searchBookmarks as searchBookmarksService } from './library/bookmarks.service'
import { lookupPlacesByNameAndLocation } from './place.service'
import { categoryService } from './category.service'
import {
  IntegrationCapabilityId,
  IntegrationId,
  MapBounds,
} from '../types/integration.types'
import { integrationManager } from './integrations'
import { INTEGRATION_PRIORITIES } from '../lib/constants'

/**
 * Convert a CategoryResult/preset to a SearchResult
 */
function convertPresetToSearchResult(preset: any): SearchResult {
  return {
    id: preset.id,
    type: 'category',
    title: preset.name,
    description:
      preset.description || `Search for ${preset.name.toLowerCase()}`,
    icon: preset.icon,
    metadata: {
      category: {
        tags: preset.tags,
        addTags: preset.addTags,
        geometry: preset.geometry,
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

  if (result.type === 'bookmark' && result.metadata.bookmark) {
    lat = result.metadata.bookmark.lat
    lng = result.metadata.bookmark.lng
  } else if (result.type === 'place' && result.metadata.place) {
    lat = result.metadata.place.geometry.value.center.lat
    lng = result.metadata.place.geometry.value.center.lng
  } else if (result.type === 'category' && result.metadata.category) {
    // Categories don't have coordinates, but include category metadata
    category = result.metadata.category
  }

  return {
    id: result.id,
    type: result.type,
    title: result.title,
    description: result.description,
    icon: result.icon,
    color: result.color,
    lat,
    lng,
    category,
  }
}

/**
 * Search recent places (placeholder for future implementation)
 */
async function searchRecentPlaces(
  userId: string,
  query: string,
): Promise<SearchResult[]> {
  // TODO: Implement recent places functionality
  // 0 characters: return recent places
  // 1+ characters: fuzzy search recent places
  return []
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
  const validPresetType =
    bookmark.presetType &&
    ['home', 'work', 'school'].includes(bookmark.presetType)
      ? (bookmark.presetType as 'home' | 'work' | 'school')
      : undefined

  // Determine description based on preset type
  let description: string | undefined
  if (validPresetType) {
    // For preset bookmarks, use the preset type as description (capitalized)
    description =
      validPresetType.charAt(0).toUpperCase() + validPresetType.slice(1)
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
    icon: validPresetType
      ? presetIcons[validPresetType] || bookmark.icon
      : bookmark.icon,
    color: bookmark.iconColor,
    metadata: {
      bookmark: {
        id: bookmark.id,
        presetType: validPresetType,
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
  // For places, use street address as description if we have both name and address
  // This helps distinguish between place names and address lookups
  let description = ''

  if (place.address?.value) {
    // Use formatted address if available
    if (place.address.value.formatted) {
      description = place.address.value.formatted
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

      description = parts.join(', ')
    }
  }

  return {
    id: place.id,
    type: 'place',
    title: place.name?.value || 'Unknown Place',
    description: description,
    icon: 'MapPin',
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
  language: SupportedLanguage = 'en',
): Promise<SearchResponse | AutocompleteResponse> {
  const {
    query,
    lat,
    lng,
    radius = 10000,
    maxResults = 50,
    autocomplete = false,
  } = options

  const allResults: SearchResult[] = []

  // Search presets/categories first (only for 1+ character queries) - these appear at the top
  if (query && query.length > 0) {
    const presets = categoryService.searchCategories(
      query,
      language,
      Math.min(10, maxResults),
    )
    const presetResults = presets.map((preset) =>
      convertPresetToSearchResult(preset),
    )
    allResults.push(...presetResults)
  }

  // Search bookmarks using bookmarks service
  const userBookmarks = await searchBookmarksService(userId, query)
  const bookmarkResults = userBookmarks.map(convertBookmarkToSearchResult)
  allResults.push(...bookmarkResults)

  // Search recent places (handles both empty query and fuzzy search)
  const recentPlaceResults = await searchRecentPlaces(userId, query)
  allResults.push(...recentPlaceResults)

  // Search external places using place service (only for 1+ character queries)
  if (query && query.length > 0 && lat && lng) {
    const places = await lookupPlacesByNameAndLocation(
      query,
      { lat, lng },
      {
        radius,
        autocomplete,
        userId,
      },
    )

    const placeResults = places.map(convertPlaceToSearchResult)
    allResults.push(...placeResults)
  }

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

  const integrationRecords = integrationManager
    .getConfiguredIntegrationsByCapability(
      IntegrationCapabilityId.SEARCH_CATEGORY,
    )
    .sort((a, b) => {
      const priorityA = INTEGRATION_PRIORITIES[a.integrationId] ?? 0
      const priorityB = INTEGRATION_PRIORITIES[b.integrationId] ?? 0
      return priorityB - priorityA
    })

  const preferredIntegration = integrationRecords[0]

  if (!preferredIntegration) {
    return [] // TODO: Return useful error to client
  }

  const integration =
    integrationManager.getCachedIntegrationInstance(preferredIntegration)

  if (!integration) {
    // TODO: Would this ever happen?
    return [] // TODO: Return useful error to client
  }

  const searchCapability = integration.capabilities.searchCategory

  // TODO: This should never happen
  if (!searchCapability?.searchByCategory) {
    throw new Error(
      `Integration ${integration.integrationId} does not support category search`,
    )
  }

  return await searchCapability.searchByCategory(presetId, options.bounds, {
    limit: options.limit,
  })
}
