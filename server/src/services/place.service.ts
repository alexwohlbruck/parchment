import type {
  Place,
  AttributedValue,
  SourceId,
  PlacePhoto,
} from '../types/place.types'
import { mergePlacesCollection, mergePlaces } from './merge.service'
import { Source } from '../lib/constants'
import { findBookmarkByExternalIds } from './library/bookmarks.service'
import * as turf from '@turf/turf'
import { integrationManager } from './integrations'
import { IntegrationCapabilityId } from '../types/integration.types'
import { User } from '../schema/users.schema'
import * as fuzz from 'fuzzball'

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

  const deduped = mergePlacesCollection(autocompleteResults)

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

        const places = await cachedIntegration.integration.getAutocomplete(
          query,
          lat,
          lng,
          radius,
        )

        return places
      } catch (error) {
        console.error(
          `Error getting autocomplete from ${cachedIntegration.integration.integrationId}:`,
          error,
        )
        return []
      }
    }),
  )

  const flatResults = results.flat()
  return flatResults
}

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

    // Collect search results from all integrations
    const searchPromises = geocodingIntegrations.map(async (integration) => {
      try {
        if (!integration.integration.searchPlaces) {
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

    const dedupedPlaces = mergePlacesCollection(places)

    if (userId && dedupedPlaces.length > 0) {
      // TODO: Where else do we need to add bookmark info?
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

/**
 * Calculates similarity between two place names using fuzzy string matching
 * Returns a score from 0 to 1, where 1 is a perfect match
 */
export function calculateNameSimilarity(name1: string, name2: string): number {
  if (!name1 || !name2) return 0

  // Normalize names for comparison
  const normalize = (name: string): string => {
    return (
      name
        .toLowerCase()
        .trim()
        // Remove common business suffixes
        .replace(
          /\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company)\b/g,
          '',
        )
        // Remove punctuation
        .replace(/[^\w\s]/g, ' ')
        // Normalize whitespace
        .replace(/\s+/g, ' ')
        .trim()
    )
  }

  const normalized1 = normalize(name1)
  const normalized2 = normalize(name2)

  // Use fuzzball's token_set_ratio for best results with business names
  // This handles word order differences and partial matches well
  const similarity = fuzz.token_set_ratio(normalized1, normalized2)

  // Convert from 0-100 scale to 0-1 scale
  return similarity / 100
}
