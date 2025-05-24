import type {
  Place,
  AttributedValue,
  SourceId,
  PlacePhoto,
} from '../types/place.types'
import { deduplicatePlacesResults, mergePlaces } from './merge.service'
import { Source } from '../lib/constants'
import { findBookmarkByExternalIds } from './library/bookmarks.service'
import * as turf from '@turf/turf'
import { integrationManager } from './integrations'
import { IntegrationCapabilityId } from '../types/integration.types'
import { User } from '../schema/users.schema'

// TODO: Sort/organize these functions better
/**
 * Get the primary photo from a place, if available
 *
 * @param place - The place to get the photo from
 * @returns The primary photo or null if not available
 */
export function getPrimaryPhoto(
  place: Place,
): AttributedValue<PlacePhoto> | null {
  if (!place.photos) return null
  return (
    place.photos.find((photo) => photo.value.isPrimary) ||
    place.photos[0] ||
    null
  )
}

/**
 * Creates an AttributedValue from a plain value
 * @param value The value to wrap
 * @param sourceId The source ID to attribute the value to
 * @param timestamp Optional timestamp
 * @returns An AttributedValue containing the value
 */
export function createAttributedValue<T>(
  value: T,
  sourceId: SourceId,
  timestamp?: string,
): AttributedValue<T> {
  return {
    value,
    sourceId,
    timestamp: timestamp || new Date().toISOString(),
  }
}

/**
 * Get the formatted address from a place, if available
 *
 * @param place - The place to get the address from
 * @returns The formatted address or null if not available
 */
export function getFormattedAddress(place: Place): string | null {
  return place.address?.value.formatted || null
}

/**
 * Add bookmark information to places
 */
async function addBookmarkInfo(places: Place[], userId: string): Promise<void> {
  try {
    for (const place of places) {
      if (place.externalIds) {
        const bookmarkInfo = await findBookmarkByExternalIds(
          place.externalIds,
          userId,
        )
        if (bookmarkInfo) {
          place.bookmark = bookmarkInfo.bookmark
          place.collectionIds = bookmarkInfo.collectionIds
        }
      }
    }
  } catch (error) {
    console.error('Error adding bookmark information:', error)
  }
}

export const getPlaceAutocomplete = async (
  query: string,
  coordinates?: { lat: number; lng: number },
  radius: number = 10000,
): Promise<Place[]> => {
  // Require at least 2 characters for autocomplete
  if (!query || query.length < 2) {
    return []
  }

  const autocompleteResults = await fetchAutocompleteResults(
    query,
    coordinates?.lat,
    coordinates?.lng,
    radius,
  )

  const deduped = deduplicatePlacesResults(autocompleteResults)

  if (coordinates) {
    // Create the from point once outside the sort function
    const fromPoint = turf.point([coordinates.lng, coordinates.lat])

    deduped.sort((a, b) => {
      // Calculate distances directly in the sort function
      const distanceA = turf.distance(
        fromPoint,
        turf.point([a.geometry.value.center.lng, a.geometry.value.center.lat]),
        { units: 'meters' },
      )
      const distanceB = turf.distance(
        fromPoint,
        turf.point([b.geometry.value.center.lng, b.geometry.value.center.lat]),
        { units: 'meters' },
      )
      return distanceA - distanceB
    })
  }
  return deduped
}

/**
 * Fetch autocomplete suggestions from all configured integrations
 * @param query The search query
 * @param lat Optional latitude for location bias
 * @param lng Optional longitude for location bias
 * @param radius Optional radius in meters for location bias
 * @returns Array of autocomplete results with source information
 */
async function fetchAutocompleteResults(
  query: string,
  lat?: number,
  lng?: number,
  radius?: number,
): Promise<Place[]> {
  const activeIntegrations = integrationManager.getIntegrationsByCapability(
    IntegrationCapabilityId.AUTOCOMPLETE,
  )

  if (activeIntegrations.length === 0) {
    return []
  }

  const results = await Promise.all(
    activeIntegrations.map(async (cachedIntegration) => {
      try {
        if (!cachedIntegration.integration.getAutocomplete) {
          return []
        }

        const predictions = await cachedIntegration.integration.getAutocomplete(
          query,
          lat,
          lng,
          radius,
        )

        console.log(
          `Got ${predictions.length} predictions from ${cachedIntegration.integration.integrationId}`,
        )

        // Transform each prediction into a Place
        return predictions.map((prediction: any) => {
          // Each integration's adapter should handle its own prediction format
          return cachedIntegration.integration.createUnifiedPlace(prediction)
        })
      } catch (error) {
        console.error(
          `Error getting autocomplete from ${cachedIntegration.integration.integrationId}:`,
          error,
        )
        return []
      }
    }),
  )

  return results.flat()
}

//////////////////////////////////////////////////

/**
 * Look up a place by ID on a given provider
 *
 * @param provider The provider ID (e.g., 'google-maps', 'pelias', 'nominatim')
 * @param placeId The provider-specific ID for the place
 * @returns Provider-specific place data or null if not found
 */
export async function lookupPlaceById(
  source: Source,
  placeId: string,
): Promise<Place | null> {
  try {
    // Get a compatible integration for this source
    const integration = integrationManager.getIntegrationForSource(
      source,
      IntegrationCapabilityId.PLACE_INFO,
    )

    if (!integration) return null

    const { integrationId } = integration

    // Get place details from the integration
    const placeData = await integrationManager.getPlaceDetails(
      integrationId,
      placeId,
    )

    const unifiedPlace = integration!.integration.createUnifiedPlace(
      placeData,
      `${integrationId}/${placeId}`,
    )

    return unifiedPlace
  } catch (error) {
    return null
  }
}

/**
 * Look up a place by name/coordinates on all available providers
 *
 * @param name The name of the place
 * @param coordinates The coordinates of the place
 * @param options Optional parameters including radius and source blacklist
 * @returns Array of Place objects from all providers
 */
export async function lookupPlacesByNameAndLocation(
  name: string,
  coordinates: { lat: number; lng: number },
  options?: {
    radius?: number
    sourceBlacklist?: Source[]
    userId?: User['id']
  },
): Promise<Place[]> {
  try {
    const { radius = 500, sourceBlacklist = [] } = options || {}

    // Get integrations that support geocoding (for searching places by name/location)
    const geocodingIntegrations = integrationManager
      .getIntegrationsByCapability(IntegrationCapabilityId.GEOCODING)
      .filter((integration) => {
        // Filter out integrations whose sources are in the blacklist
        return !integration.integration.sources.some((source) =>
          sourceBlacklist.includes(source),
        )
      })

    if (geocodingIntegrations.length === 0) {
      return []
    }

    console.log(`Found ${geocodingIntegrations.length} geocoding integrations`)

    // Collect search results from all integrations
    const searchPromises = geocodingIntegrations.map(async (integration) => {
      try {
        if (!integration.integration.searchPlaces) {
          console.log(
            `Integration ${integration.integrationId} doesn't implement searchPlaces`,
          )
          return []
        }

        // Call the integration's searchPlaces method
        const results = await integration.integration.searchPlaces(
          name,
          coordinates.lat,
          coordinates.lng,
          radius,
        )

        if (!results || results.length === 0) {
          return []
        }

        console.log(
          `Got ${results.length} results from ${integration.integrationId}`,
        )

        // Transform each result to a Place
        const unifiedPlaces = results.map((result) =>
          integration.integration.createUnifiedPlace(
            result,
            `${integration.integrationId}/${result.id || 'unknown'}`,
          ),
        )

        const sorted = unifiedPlaces.sort((a, b) => {
          const fromPoint = turf.point([coordinates.lng, coordinates.lat])
          const distanceA = turf.distance(
            fromPoint,
            turf.point([
              a.geometry.value.center.lng,
              a.geometry.value.center.lat,
            ]),
          )
          const distanceB = turf.distance(
            fromPoint,
            turf.point([
              b.geometry.value.center.lng,
              b.geometry.value.center.lat,
            ]),
          )
          return distanceA - distanceB
        })

        return sorted
      } catch (error) {
        console.error(
          `Error searching places with ${integration.integrationId}:`,
          error,
        )
        return []
      }
    })

    // Wait for all search operations to complete
    const searchResults = await Promise.all(searchPromises)
    const allResults = searchResults.flat()

    console.log(`Found ${allResults.length} total results from all providers`)

    return allResults
  } catch (error) {
    console.error('Error looking up places by name and coordinates:', error)
    return []
  }
}

/**
 * Look up a place by name/coordinates
 * Uses lookupPlacesByNameAndCoordinates and fetches the best result
 *
 * @param name The name of the place
 * @param coordinates The coordinates of the place
 * @param options Optional parameters including userId, radius and source blacklist
 * @returns A deduplicated Place object
 */
export async function lookupPlaceByNameAndLocation(
  name: string,
  coordinates: { lat: number; lng: number },
  options?: {
    userId?: User['id']
    radius?: number
    sourceBlacklist?: Source[]
  },
): Promise<Place | null> {
  try {
    const { userId, radius = 500, sourceBlacklist = [] } = options || {}

    // Get all places matching the name and coordinates from all providers
    const places = await lookupPlacesByNameAndLocation(name, coordinates, {
      radius,
      sourceBlacklist,
    })

    if (places.length === 0) {
      return null
    }

    const dedupedPlaces = deduplicatePlacesResults(places)

    if (userId && dedupedPlaces.length > 0) {
      await addBookmarkInfo(dedupedPlaces, userId)
    }

    return dedupedPlaces[0] || null
  } catch (error) {
    console.error('Error getting place by name and coordinates:', error)
    return null
  }
}

/**
 * Look up a place by ID and enrich it with data from other sources
 *
 * @param source The source ID (e.g., SOURCE.GOOGLE, SOURCE.OSM)
 * @param id The ID for the place in that source
 * @param options Optional parameters including userId
 * @returns A merged Place object with consolidated data from multiple sources
 */
export async function lookupAndMergePlaceById(
  source: Source,
  id: string,
  options?: {
    userId?: User['id']
  },
): Promise<Place | null> {
  try {
    const { userId } = options || {}

    // First, get the place from the primary source
    let place = await lookupPlaceById(source, id)
    if (!place) return null

    // If place has name and location, try to find it in other sources
    if (place.name && place.geometry.value.center) {
      const { lat, lng } = place.geometry.value.center

      const thirdPartyPlace = await lookupPlaceByNameAndLocation(
        place.name.value,
        { lat, lng },
        {
          radius: 500,
          sourceBlacklist: [source], // Exclude the original source
        },
      )

      // Merge the place data from other providers with the primary source
      if (thirdPartyPlace) {
        place = mergePlaces(place, thirdPartyPlace)
      }
    }

    // Add bookmark information if user ID is provided
    if (userId && place) {
      const bookmarkInfo = await findBookmarkByExternalIds(
        place.externalIds,
        userId,
      )
      if (bookmarkInfo) {
        place.bookmark = bookmarkInfo.bookmark
        place.collectionIds = bookmarkInfo.collectionIds
      }
    }

    return place
  } catch (error) {
    console.error(
      `Error looking up and merging place data (${source}/${id}):`,
      error,
    )
    return null
  }
}

// TODO: This already exists in the merge service. Fix this duplicate code
/**
 * Calculates similarity between two place names
 *
 * This function is a critical part of place deduplication. It determines how
 * similar two place names are, accounting for:
 * - Business name variations and suffixes (LLC, Inc, etc.)
 * - Building/property type standardization (apartment/apartments, condo/condominiums)
 * - Directional abbreviations (N, S, E, W)
 * - Common words and articles to ignore
 * - Name structure and word order
 *
 * The algorithm returns a score from 0 to 1, where:
 * - 1.0 = Perfect match
 * - 0.9+ = Very strong match (likely the same place)
 * - 0.8+ = Strong match (probably the same place)
 * - 0.7+ = Moderate match (possibly the same place, needs proximity check)
 * - <0.7 = Weak match (likely different places)
 *
 * This is used alongside geographic proximity to identify the same real-world
 * place across different data providers, each with their own naming conventions.
 */
export function calculateNameSimilarity(name1: string, name2: string): number {
  if (!name1 || !name2) return 0

  const normalizeForComparison = (name: string): string => {
    // Normalize case and whitespace
    let normalized = name.toLowerCase().trim()

    // Remove punctuation
    normalized = normalized.replace(/[^\w\s]/g, '')

    // Common business/residential suffixes to remove for comparison
    const businessSuffixes = [
      'inc',
      'incorporated',
      'llc',
      'ltd',
      'limited',
      'corp',
      'corporation',
      'co',
      'company',
      'enterprises',
      'holdings',
      'group',
    ]

    // Building/property type words - don't remove as they're important for matching similar buildings
    const buildingTypes = [
      'apartments',
      'apartment',
      'condominiums',
      'condominium',
      'condo',
      'condos',
      'residence',
      'residences',
      'tower',
      'towers',
      'plaza',
      'square',
      'building',
      'center',
      'centre',
      'complex',
      'park',
      'house',
      'homes',
      'villas',
      'suites',
    ]

    // Direction abbreviations
    const directionMap: Record<string, string> = {
      n: 'north',
      s: 'south',
      e: 'east',
      w: 'west',
      ne: 'northeast',
      nw: 'northwest',
      se: 'southeast',
      sw: 'southwest',
    }

    // Expand direction abbreviations
    for (const [abbr, full] of Object.entries(directionMap)) {
      const abbrPattern = new RegExp(`\\b${abbr}\\b`, 'g')
      normalized = normalized.replace(abbrPattern, full)
    }

    // Split into words
    let words = normalized.split(/\s+/)

    // Filter out business suffixes but keep building type words
    words = words.filter((word) => !businessSuffixes.includes(word))

    // Special treatment for building types (preserve them but standardize)
    let standardizedBuildingType = ''
    for (const word of words) {
      if (buildingTypes.includes(word)) {
        // If it's "condo", "condos", or "condominium", standardize to "condominiums"
        if (['condo', 'condos', 'condominium'].includes(word)) {
          standardizedBuildingType = 'condominiums'
        }
        // If it's "apartment" or similar, standardize to "apartments"
        else if (['apartment', 'residence'].includes(word)) {
          standardizedBuildingType = 'apartments'
        } else {
          standardizedBuildingType = word
        }
      }
    }

    // Final string without building type (we'll add standardized version back later if found)
    normalized = words.filter((word) => !buildingTypes.includes(word)).join(' ')

    // Add back standardized building type if we found one
    if (standardizedBuildingType) {
      normalized += ' ' + standardizedBuildingType
    }

    return normalized.trim()
  }

  // Normalize both names
  const normalized1 = normalizeForComparison(name1)
  const normalized2 = normalizeForComparison(name2)

  // If names are exactly the same after normalization
  if (normalized1 === normalized2) {
    return 1
  }

  // Check if the first significant words are completely different
  const words1 = normalized1.split(/\s+/)
  const words2 = normalized2.split(/\s+/)

  // Get the first significant word from each name (skip short words like "the", "at", etc.)
  const getFirstSignificantWord = (words: string[]): string => {
    for (const word of words) {
      if (
        word.length > 2 &&
        !['the', 'and', 'for', 'of', 'at', 'in', 'on', 'by'].includes(word)
      ) {
        return word
      }
    }
    return words[0] || ''
  }

  const firstWord1 = getFirstSignificantWord(words1)
  const firstWord2 = getFirstSignificantWord(words2)

  // If the first significant words are completely different and not building types,
  // this is likely a mismatch of completely different places
  const buildingTypes = [
    'apartments',
    'condominiums',
    'towers',
    'plaza',
    'square',
    'complex',
    'residence',
  ]
  if (
    firstWord1 !== firstWord2 &&
    !buildingTypes.includes(firstWord1) &&
    !buildingTypes.includes(firstWord2) &&
    firstWord1.length > 3 &&
    firstWord2.length > 3
  ) {
    return 0.2
  }

  // If one is a substring of the other, it's likely a match
  if (normalized1.includes(normalized2) || normalized2.includes(normalized1)) {
    // Calculate how much of the longer string is covered
    const coverage =
      Math.min(normalized1.length, normalized2.length) /
      Math.max(normalized1.length, normalized2.length)

    // Higher similarity for more complete coverage
    const similarityScore = 0.7 + coverage * 0.3
    return similarityScore
  }

  // Calculate how many words match
  const commonWords = words1.filter((word) => words2.includes(word))
  if (commonWords.length === 0) {
    return 0
  }

  // Calculate similarity based on common words
  const overallSimilarity =
    (commonWords.length * 2) / (words1.length + words2.length)

  // Boost score if the first significant words (likely the most important part of the name) match
  const firstWordsMatch = firstWord1 === firstWord2 && firstWord1.length > 3

  let finalScore = overallSimilarity
  if (firstWordsMatch) {
    finalScore = Math.min(1, overallSimilarity + 0.2) // Boost but cap at 1.0
  }

  return finalScore
}
