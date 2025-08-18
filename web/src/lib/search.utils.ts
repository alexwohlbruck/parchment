import { MapPinIcon, LocateIcon } from 'lucide-vue-next'
import * as LucideIcons from 'lucide-vue-next'
import { Component } from 'vue'
import { Place } from '@/types/place.types'
import { SearchResultType, AutocompleteResult } from '@/types/search.types'
import { formatAddress } from '@/lib/place.utils'

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
 * Get the display name for a search result
 */
export function getSearchResultName(place: Place): string {
  // Handle bookmarks - always use bookmark name over place name
  if (place.placeType.value === 'bookmark' && place.bookmark) {
    return place.bookmark.name
  }

  // Handle current location
  if (place.id === 'current-location') {
    return place.name.value
  }

  // Default to place name for regular places
  return place.name.value
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
    } as Place
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
    } as Place
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
  } as Place
}

/**
 * Convert a SearchResult object to a Place object for rich display
 */
export function searchResultToPlace(result: any): Place {
  // Check if this is a SearchResult with metadata
  if (result.metadata) {
    if (result.type === 'bookmark' && result.metadata.bookmark) {
      const bookmark = result.metadata.bookmark
      return {
        id: result.id,
        name: {
          value: result.title,
          sourceId: 'search',
          timestamp: new Date().toISOString(),
        },
        description: result.description
          ? {
              value: result.description,
              sourceId: 'search',
              timestamp: new Date().toISOString(),
            }
          : null,
        geometry: {
          value: {
            type: 'point',
            center: {
              lat: bookmark.lat,
              lng: bookmark.lng,
            },
          },
          sourceId: 'search',
          timestamp: new Date().toISOString(),
        },
        photos: [],
        externalIds: bookmark.externalIds || {},
        address: bookmark.address
          ? {
              value: { formatted: bookmark.address },
              sourceId: 'search',
              timestamp: new Date().toISOString(),
            }
          : null,
        placeType: {
          value: 'bookmark',
          sourceId: 'search',
          timestamp: new Date().toISOString(),
        },
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
          userId: 'search-user', // Add required userId field
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        contactInfo: {
          phone: null,
          email: null,
          website: null,
          socials: {},
        },
        openingHours: null,
        ratings: undefined,
        amenities: {},
        sources: [],
        lastUpdated: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      } as Place
    }

    if (result.type === 'current_location' && result.metadata.currentLocation) {
      const location = result.metadata.currentLocation
      return {
        id: 'current-location',
        name: {
          value: result.title,
          sourceId: 'search',
          timestamp: new Date().toISOString(),
        },
        description: null,
        geometry: {
          value: {
            type: 'point',
            center: {
              lat: location.lat,
              lng: location.lng,
            },
          },
          sourceId: 'search',
          timestamp: new Date().toISOString(),
        },
        photos: [],
        externalIds: {},
        address: null,
        placeType: {
          value: 'current_location',
          sourceId: 'search',
          timestamp: new Date().toISOString(),
        },
        contactInfo: {
          phone: null,
          email: null,
          website: null,
          socials: {},
        },
        openingHours: null,
        ratings: undefined,
        amenities: {},
        sources: [],
        lastUpdated: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      } as Place
    }

    if (result.type === 'place' && result.metadata.place) {
      const place = result.metadata.place
      return {
        id: result.id,
        name: {
          value: result.title,
          sourceId: 'search',
          timestamp: new Date().toISOString(),
        },
        description: result.description
          ? {
              value: result.description,
              sourceId: 'search',
              timestamp: new Date().toISOString(),
            }
          : null,
        geometry: {
          value: {
            type: 'point',
            center: {
              lat: place.lat,
              lng: place.lng,
            },
          },
          sourceId: 'search',
          timestamp: new Date().toISOString(),
        },
        photos: [],
        externalIds: place.externalIds || {},
        address: place.address
          ? {
              value: { formatted: place.address },
              sourceId: 'search',
              timestamp: new Date().toISOString(),
            }
          : result.description
          ? {
              value: { formatted: result.description },
              sourceId: 'search',
              timestamp: new Date().toISOString(),
            }
          : null,
        placeType: {
          value: place.placeType || 'place',
          sourceId: 'search',
          timestamp: new Date().toISOString(),
        },
        contactInfo: {
          phone: place.contactInfo?.phone
            ? {
                value: place.contactInfo.phone,
                sourceId: 'search',
                timestamp: new Date().toISOString(),
              }
            : null,
          email: place.contactInfo?.email
            ? {
                value: place.contactInfo.email,
                sourceId: 'search',
                timestamp: new Date().toISOString(),
              }
            : null,
          website: place.contactInfo?.website
            ? {
                value: place.contactInfo.website,
                sourceId: 'search',
                timestamp: new Date().toISOString(),
              }
            : null,
          socials: {},
        },
        openingHours: place.openingHours
          ? {
              value: place.openingHours,
              sourceId: 'search',
              timestamp: new Date().toISOString(),
            }
          : null,
        ratings: place.ratings
          ? {
              rating: place.ratings.rating
                ? {
                    value: place.ratings.rating,
                    sourceId: 'search',
                    timestamp: new Date().toISOString(),
                  }
                : undefined,
              reviewCount: place.ratings.reviewCount
                ? {
                    value: place.ratings.reviewCount,
                    sourceId: 'search',
                    timestamp: new Date().toISOString(),
                  }
                : undefined,
            }
          : undefined,
        amenities: place.amenities
          ? Object.fromEntries(
              Object.entries(place.amenities).map(([key, value]) => [
                key,
                {
                  value,
                  sourceId: 'search',
                  timestamp: new Date().toISOString(),
                },
              ]),
            )
          : {},
        sources: [],
        lastUpdated: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      } as Place
    }
  }

  // Fallback to autocomplete conversion for simple results
  return autocompleteResultToPlace(result)
}
