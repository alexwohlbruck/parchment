import {
  SearchResult,
  SearchOptions,
  SearchResponse,
  AutocompleteResult,
  AutocompleteResponse,
  CategoryResult,
} from '../types/search.types'
import { Bookmark } from '../types/library.types'
import { Place } from '../types/place.types'
import type { SupportedLanguage } from '../lib/i18n'
// Import existing services
import { searchBookmarks as searchBookmarksService } from './library/bookmarks.service'
import { lookupPlacesByNameAndLocation } from './place.service'
import { searchCategories, getCategoryById } from './category.service'

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
    lat = result.metadata.place.lat
    lng = result.metadata.place.lng
  } else if (result.type === 'category' && result.metadata.category) {
    // Categories don't have coordinates, but include category metadata
    category = result.metadata.category
  } else if (
    result.type === 'current_location' &&
    result.metadata.currentLocation
  ) {
    lat = result.metadata.currentLocation.lat
    lng = result.metadata.currentLocation.lng
  } else {
    lat = 0
    lng = 0
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
 * Convert a CategoryResult to a SearchResult
 */
function convertCategoryToSearchResult(category: CategoryResult): SearchResult {
  return {
    id: category.id,
    type: 'category',
    title: category.name,
    description: category.description,
    icon: category.icon,
    color: category.color,
    metadata: {
      category: {
        tags: category.tags,
        addTags: category.addTags,
        geometry: category.geometry,
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
    title: place.name.value,
    description: description,
    icon: 'MapPin',
    metadata: {
      place: {
        id: place.id,
        externalIds: place.externalIds,
        address: place.address?.value?.formatted || description,
        lat: place.geometry.value.center.lat,
        lng: place.geometry.value.center.lng,
        placeType: place.placeType?.value,
      },
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

  // Search categories first (only for 1+ character queries) - these appear at the top
  if (query && query.length > 0) {
    const categories = searchCategories(
      query,
      language,
      Math.min(10, maxResults),
    )
    const categoryResults = categories.map(convertCategoryToSearchResult)
    allResults.push(...categoryResults)
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
        autocomplete: true, // Use autocomplete capability for fast results
        userId, // This will add bookmark info to places
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
export async function getCategoryDetails(
  categoryId: string,
  language: SupportedLanguage = 'en',
): Promise<CategoryResult | null> {
  return getCategoryById(categoryId, language)
}
