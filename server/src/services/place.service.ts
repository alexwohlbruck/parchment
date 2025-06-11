import type { Place } from '../types/place.types'
import { mergePlacesCollection, mergePlaces } from './merge.service'
import { Source } from '../lib/constants'
import { findBookmarkByExternalIds } from './library/bookmarks.service'
import * as turf from '@turf/turf'
import { integrationManager } from './integrations'
import { IntegrationCapabilityId } from '../types/integration.types'
import { User } from '../schema/users.schema'

// TODO: Move this to more relevant file (merge service?)
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

/**
 * Look up a place by ID from a given source
 *
 * @param source The source ID (e.g., SOURCE.GOOGLE, SOURCE.OSM)
 * @param placeId The provider-specific ID for the place
 * @returns Provider-specific place data or null if not found
 */
export async function lookupPlaceById(
  source: Source,
  placeId: string,
): Promise<Place | null> {
  try {
    const integrationRecord =
      integrationManager.getConfiguredIntegrationForSource(
        source,
        IntegrationCapabilityId.PLACE_INFO,
      )

    if (!integrationRecord) return null

    const integration =
      integrationManager.getCachedIntegrationInstance(integrationRecord)
    if (!integration) return null

    return (
      (await integration.capabilities.placeInfo?.getPlaceInfo(placeId)) ?? null
    )
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
// TODO: Full implementation for search results instead of autocomplete results
export async function lookupPlacesByNameAndLocation(
  name: string,
  coordinates: { lat: number; lng: number },
  options?: {
    autocomplete?: boolean
    radius?: number
    sourceBlacklist?: Source[]
    userId?: User['id']
  },
): Promise<Place[]> {
  try {
    const {
      radius = 500,
      sourceBlacklist = [],
      autocomplete = false,
    } = options || {}

    const integrationRecords = integrationManager
      .getConfiguredIntegrationsByCapability(
        autocomplete
          ? IntegrationCapabilityId.AUTOCOMPLETE
          : IntegrationCapabilityId.SEARCH,
      )
      .filter((integrationRecord) => {
        // Get the cached integration instance to check sources
        const integration =
          integrationManager.getCachedIntegrationInstance(integrationRecord)
        // Filter out integrations whose sources are in the blacklist
        return !integration?.sources?.some((source: Source) =>
          sourceBlacklist.includes(source),
        )
      })

    if (integrationRecords.length === 0) {
      // TODO: Return useful error to client
      return []
    }

    const searchPromises = integrationRecords.map(async (integrationRecord) => {
      const integration =
        integrationManager.getCachedIntegrationInstance(integrationRecord)
      if (!integration) return null

      if (autocomplete) {
        return integration.capabilities.autocomplete?.getAutocomplete(
          name,
          coordinates.lat,
          coordinates.lng,
        )
      } else {
        return integration.capabilities.search?.searchPlaces(
          name,
          coordinates.lat,
          coordinates.lng,
        )
      }
    })

    const results = (await Promise.all(searchPromises))
      .flat()
      .filter(
        (result): result is Place => result !== null && result !== undefined,
      )

    return mergePlacesCollection(results).sort((a, b) => {
      // Sort by distance from coordinates
      const distanceA = turf.distance(
        turf.point([coordinates.lng, coordinates.lat]),
        turf.point([a.geometry.value.center.lng, a.geometry.value.center.lat]),
        { units: 'meters' },
      )
      const distanceB = turf.distance(
        turf.point([coordinates.lng, coordinates.lat]),
        turf.point([b.geometry.value.center.lng, b.geometry.value.center.lat]),
        { units: 'meters' },
      )
      return distanceA - distanceB
    })
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
    autocomplete?: boolean
    userId?: User['id']
    radius?: number
    sourceBlacklist?: Source[]
  },
): Promise<Place | null> {
  try {
    const {
      userId,
      radius = 500,
      sourceBlacklist = [],
      autocomplete = false,
    } = options || {}

    // Get all places matching the name and coordinates from all providers
    const places = await lookupPlacesByNameAndLocation(name, coordinates, {
      radius,
      sourceBlacklist,
      autocomplete,
    })

    if (places.length === 0) {
      return null
    }

    if (userId && places.length > 0) {
      // TODO: Where else do we need to add bookmark info?
      await addBookmarkInfo(places, userId)
    }

    return places[0] || null
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
export async function lookupEnrichedPlaceById(
  source: Source,
  id: string,
  options?: {
    userId?: User['id']
  },
): Promise<Place | null> {
  try {
    const { userId } = options || {}

    let place = await lookupPlaceById(source, id)
    if (!place) return null

    // If place has name and location, look it up from other sources and merge in
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
