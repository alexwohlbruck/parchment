import { MapPinIcon, LocateIcon } from 'lucide-vue-next'
import * as LucideIcons from 'lucide-vue-next'
import { Component } from 'vue'
import { Place, type PlaceCategory } from '@/types/place.types'
import { SearchResultType, AutocompleteResult } from '@/types/search.types'
import { formatAddress } from '@/lib/place.utils'
import { AppRoute } from '@/router'

/**
 * Get the appropriate icon for a search result
 */
export function getSearchResultIcon(place: Place): Component {
  // Handle current location
  if (place.id === 'current-location') {
    return LocateIcon
  }

  // Handle bookmarks - use the stored icon from the database
  if (place.placeType.value === 'bookmark' && place.bookmark?.icon) {
    const iconName = place.bookmark.icon
    const fullName = iconName.endsWith('Icon') ? iconName : `${iconName}Icon`

    const isValidIcon =
      fullName !== 'icons' &&
      typeof LucideIcons[fullName as keyof typeof LucideIcons] === 'function'

    if (isValidIcon) {
      return LucideIcons[fullName as keyof typeof LucideIcons] as Component
    }
  }

  return MapPinIcon
}

/**
 * Get the icon name as a string for use with ItemIcon component
 */
export function getSearchResultIconName(place: Place): string {
  // Handle current location
  if (place.id === 'current-location') {
    return 'Locate'
  }

  // Handle bookmarks - use the stored icon from the database
  if (place.placeType.value === 'bookmark' && place.bookmark?.icon) {
    const iconName = place.bookmark.icon
    // Remove 'Icon' suffix if present for ItemIcon component
    return iconName.endsWith('Icon') ? iconName.slice(0, -4) : iconName
  }

  // Use place icon from OSM preset matching
  if (place.icon?.icon) {
    return place.icon.icon
  }

  return 'MapPin'
}

/**
 * Get the icon pack for a place (lucide or maki)
 */
export function getSearchResultIconPack(place: Place): 'lucide' | 'maki' {
  if (place.id === 'current-location') return 'lucide'
  if (place.placeType.value === 'bookmark' && place.bookmark?.icon) return 'lucide'
  return place.icon?.iconPack || 'lucide'
}

/**
 * Get the place category for coloring
 */
export function getSearchResultCategory(place: Place): PlaceCategory {
  return place.icon?.category || 'default'
}

/**
 * Get the display name for a search result
 */
export function getSearchResultName(place: Place): string {
  // Handle bookmarks - always use bookmark name over place name
  if (place.placeType.value === 'bookmark' && place.bookmark) {
    return place.bookmark.name
  }

  // Handle current location
  if (place.id === 'current-location') {
    return place.name.value || 'Current Location'
  }

  // If place has a name, use it
  if (place.name.value) {
    return place.name.value
  }

  // For unnamed places, prefer the type label (e.g. "Drinking Water") over address
  const type = place.placeType?.value
  if (type && type !== 'place') {
    return type.charAt(0).toUpperCase() + type.slice(1)
  }

  // Last resort: formatted address
  return formatAddress(place)
}

/**
 * Get the description for a search result
 */
export function getSearchResultDescription(place: Place): string {
  // Handle current location
  if (place.id === 'current-location') {
    return 'Your current location'
  }

  // Handle bookmarks
  if (place.placeType.value === 'bookmark') {
    const parts: string[] = []

    // Get preset type from bookmark if available, otherwise use place type
    const presetType = place.bookmark?.presetType || place.placeType.value

    // Add preset type if it exists and isn't just 'bookmark'
    if (presetType && presetType !== 'bookmark') {
      parts.push(presetType.charAt(0).toUpperCase() + presetType.slice(1))
    } else {
      parts.push('Saved')
    }

    // Add address if available
    const address = formatAddress(place)
    if (address) {
      parts.push(address)
    }

    return parts.join(' • ')
  }

  // Default to formatted address for regular places
  return formatAddress(place)
}

/**
 * Determine the search result type based on the place
 */
export function getSearchResultType(place: Place): SearchResultType {
  if (place.id === 'current-location') {
    return SearchResultType.CURRENT_LOCATION
  }

  if (place.placeType.value === 'bookmark') {
    return SearchResultType.BOOKMARK
  }

  return SearchResultType.PLACE
}

/**
 * Convert a Place object to a standardized SearchResult
 */
export function placeToSearchResult(place: Place): any {
  return {
    id: place.id,
    value: place.id,
    name: getSearchResultName(place),
    description: getSearchResultDescription(place),
    icon: getSearchResultIcon(place),
    type: getSearchResultType(place),
    place,
  }
}

/**
 * Get icon for search result type
 */
export function getSearchResultTypeIcon(type: SearchResultType): Component {
  switch (type) {
    case SearchResultType.CURRENT_LOCATION:
      return LocateIcon
    case SearchResultType.BOOKMARK:
      return MapPinIcon
    case SearchResultType.PLACE:
    default:
      return MapPinIcon
  }
}

/**
 * Convert an AutocompleteResult object to a legacy Place object for compatibility
 */
export function autocompleteResultToPlace(result: AutocompleteResult): Place {
  if (result.type === 'bookmark') {
    return {
      id: result.id,
      name: { value: result.title },
      geometry: {
        value: {
          type: 'point',
          center: {
            lat: result.lat,
            lng: result.lng,
          },
        },
      },
      externalIds: {},
      address: result.description
        ? { value: { formatted: result.description } }
        : null,
      placeType: { value: 'bookmark' },
      bookmark: {
        id: result.id,
        name: result.title,
        icon: result.icon || 'map-pin',
        iconColor: result.color || 'rose',
      },
    } as unknown as Place // TODO: Fix this
  }

  if (result.type === 'current_location') {
    return {
      id: 'current-location',
      name: { value: result.title },
      geometry: {
        value: {
          type: 'point',
          center: {
            lat: result.lat,
            lng: result.lng,
          },
        },
      },
      externalIds: {},
      address: null,
      placeType: { value: 'current_location' },
    } as unknown as Place
  }

  // Default for 'place' type and fallback
  return {
    id: result.id,
    name: { value: result.title },
    geometry: {
      value: {
        type: 'point',
        center: {
          lat: result.lat,
          lng: result.lng,
        },
      },
    },
    externalIds: {},
    address: result.description
      ? { value: { formatted: result.description } }
      : null,
    placeType: { value: 'place' },
  } as unknown as Place
}

/**
 * Create a route for search results
 */
export function createSearchResultsRoute(options: {
  query?: string
  categoryId?: string
  categoryName?: string
  overpassQuery?: string
}) {
  const routeQuery: Record<string, string> = {}

  if (options.query) routeQuery.q = options.query
  if (options.categoryId) routeQuery.categoryId = options.categoryId
  if (options.categoryName) routeQuery.categoryName = options.categoryName
  if (options.overpassQuery) routeQuery.overpassQuery = options.overpassQuery

  return {
    name: AppRoute.SEARCH_RESULTS,
    query: routeQuery,
  }
}

// ── Per-type adapters ─────────────────────────────────────────────────────────

/** Shared source field added to all sourced fields when converting from a search result. */
function sourceField<T>(value: T) {
  return { value, sourceId: 'search', timestamp: new Date().toISOString() }
}

/** Shared empty contact info block. */
function emptyContactInfo() {
  return { phone: null, email: null, website: null, socials: {} }
}

/**
 * Convert a bookmark search result (with metadata.bookmark) to a Place.
 */
export function adaptBookmarkResult(result: any): Place {
  const bookmark = result.metadata.bookmark
  return {
    id: result.id,
    name: sourceField(result.title),
    description: result.description ? sourceField(result.description) : null,
    geometry: sourceField({
      type: 'point',
      center: { lat: bookmark.lat, lng: bookmark.lng },
    }),
    photos: [],
    externalIds: bookmark.externalIds || {},
    address: bookmark.address ? sourceField({ formatted: bookmark.address }) : null,
    placeType: sourceField('bookmark'),
    bookmark: {
      id: bookmark.id,
      name: result.title,
      icon: result.icon || 'map-pin',
      iconColor: result.color || 'rose',
      presetType: bookmark.presetType,
      lat: bookmark.lat,
      lng: bookmark.lng,
      address: bookmark.address,
      externalIds: bookmark.externalIds,
      userId: 'search-user',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    contactInfo: emptyContactInfo(),
    openingHours: null,
    ratings: undefined,
    amenities: {},
    sources: [],
    lastUpdated: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  } as unknown as Place
}

/**
 * Convert a current_location search result (with metadata.currentLocation) to a Place.
 */
export function adaptCurrentLocationResult(result: any): Place {
  const location = result.metadata.currentLocation
  return {
    id: 'current-location',
    name: sourceField(result.title),
    description: null,
    geometry: sourceField({
      type: 'point',
      center: { lat: location.lat, lng: location.lng },
    }),
    photos: [],
    externalIds: {},
    address: null,
    placeType: sourceField('current_location'),
    contactInfo: emptyContactInfo(),
    openingHours: null,
    ratings: undefined,
    amenities: {},
    sources: [],
    lastUpdated: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  } as unknown as Place
}

/**
 * Convert a place search result (with metadata.place) to a Place.
 */
export function adaptPlaceResult(result: any): Place {
  const place = result.metadata.place

  const address = place.address
    ? sourceField({ formatted: place.address })
    : result.description
      ? sourceField({ formatted: result.description })
      : null

  const contactInfo = {
    phone: place.contactInfo?.phone ? sourceField(place.contactInfo.phone) : null,
    email: place.contactInfo?.email ? sourceField(place.contactInfo.email) : null,
    website: place.contactInfo?.website ? sourceField(place.contactInfo.website) : null,
    socials: {},
  }

  const ratings = place.ratings
    ? {
        rating: place.ratings.rating ? sourceField(place.ratings.rating) : undefined,
        reviewCount: place.ratings.reviewCount ? sourceField(place.ratings.reviewCount) : undefined,
      }
    : undefined

  const amenities = place.amenities
    ? Object.fromEntries(
        Object.entries(place.amenities).map(([key, value]) => [key, sourceField(value)]),
      )
    : {}

  return {
    id: result.id,
    name: sourceField(result.title),
    description: result.description ? sourceField(result.description) : null,
    geometry: sourceField({
      type: 'point',
      center: { lat: place.lat, lng: place.lng },
    }),
    photos: [],
    externalIds: place.externalIds || {},
    address,
    placeType: sourceField(place.placeType || 'place'),
    contactInfo,
    openingHours: place.openingHours ? sourceField(place.openingHours) : null,
    ratings,
    amenities,
    sources: [],
    lastUpdated: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  } as unknown as Place
}

/**
 * Convert a SearchResult object to a Place object for rich display.
 * Dispatches to the appropriate per-type adapter based on `result.type`.
 */
export function searchResultToPlace(result: any): Place {
  if (result.metadata) {
    if (result.type === 'bookmark' && result.metadata.bookmark) {
      return adaptBookmarkResult(result)
    }
    if (result.type === 'current_location' && result.metadata.currentLocation) {
      return adaptCurrentLocationResult(result)
    }
    if (result.type === 'place' && result.metadata.place) {
      return adaptPlaceResult(result)
    }
  }

  // Fallback to autocomplete conversion for simple results
  return autocompleteResultToPlace(result)
}
