import type { Place, GooglePlaceDetails } from '../types/place.types'
import type {
  UnifiedPlace,
  PlaceGeometry,
  Address,
  PlacePhoto,
  SourceReference,
} from '../types/unified-place.types'
import { getPlaceType } from '../lib/place.utils'
import { deduplicatePlacesResults, mergePlaces } from './merge.service'
import { fetchPlaceFromOverpass } from './overpass.service'
import { googleAdapter } from '../adapters/google-adapter'
import { Source, SOURCE } from '../lib/constants'
import { osmAdapter } from '../adapters/osm-adapter'
import type { Bookmark } from '../types/library.types'
import { findBookmarkByExternalIds } from './library/bookmarks.service'
import * as turf from '@turf/turf'
import { integrationManager } from './integrations'
import {
  IntegrationCapabilityId,
  IntegrationId,
} from '../types/integration.types'

// TODO: Replace with unified place
// New type for search results
export interface PlaceSearchResult {
  id: string
  name: string
  placeType: string
  geometry: PlaceGeometry
  address?: Address | null
  description?: string
  photo?: PlacePhoto | null
  ratings?: {
    rating: number
    reviewCount: number
  }
  priceLevel?: string
  openingHours?: {
    isOpenNow: boolean
    regularHours?: { day: number; open: string; close: string }[]
  }
  distance?: number
  sources: SourceReference[]
  bookmark?: Bookmark | null
  collectionIds?: string[] | null
}

// New interface to represent a place candidate before merging
interface PlaceCandidate {
  osmPlace?: Place
  googlePlace?: GooglePlaceDetails
  similarity: number
  distance: number
}

// Create a simplified search result from a unified place
function createSearchResult(unifiedPlace: UnifiedPlace): PlaceSearchResult {
  // Find primary photo
  const primaryPhoto =
    unifiedPlace.photos.find((p) => p.isPrimary) ||
    unifiedPlace.photos[0] ||
    null

  return {
    id: unifiedPlace.id,
    name: unifiedPlace.name,
    placeType: unifiedPlace.placeType,
    geometry: unifiedPlace.geometry,
    address: unifiedPlace.address,
    description: unifiedPlace.description,
    photo: primaryPhoto,
    ratings: unifiedPlace.ratings
      ? {
          rating: unifiedPlace.ratings.rating?.value || 0,
          reviewCount: unifiedPlace.ratings.reviewCount?.value || 0,
        }
      : undefined,
    openingHours: unifiedPlace.openingHours
      ? {
          isOpenNow:
            unifiedPlace.openingHours.isOpen24_7 ||
            (!unifiedPlace.openingHours.isPermanentlyClosed &&
              !unifiedPlace.openingHours.isTemporarilyClosed),
          regularHours: unifiedPlace.openingHours.regularHours,
        }
      : undefined,
    sources: unifiedPlace.sources,
    bookmark: unifiedPlace.bookmark || null,
    collectionIds: unifiedPlace.collectionIds || null,
  }
}

// Match and bucket search results from multiple sources
export function matchPlaceCandidates(
  targetPlace: Place,
  candidates: GooglePlaceDetails[] | Place[],
  coordinates?: { lat: number; lng: number },
): PlaceCandidate[] {
  if (!targetPlace || !candidates || candidates.length === 0) {
    return []
  }

  // Create a Turf point from the target coordinates for spatial analysis
  const targetPoint = coordinates
    ? turf.point([coordinates.lng, coordinates.lat])
    : targetPlace.center
    ? turf.point([targetPlace.center.lon, targetPlace.center.lat])
    : null

  // Calculate match scores for all candidates
  const candidatesWithScores: PlaceCandidate[] = candidates.map((candidate) => {
    // Skip if it's the same place
    if ('id' in candidate && candidate.id === targetPlace.id) {
      return {
        googlePlace:
          'place_id' in candidate
            ? (candidate as unknown as GooglePlaceDetails)
            : undefined,
        osmPlace: 'type' in candidate ? (candidate as Place) : undefined,
        similarity: 0,
        distance: Infinity,
      }
    }

    // Extract candidate name from either Google or OSM data
    const candidateName =
      'name' in candidate ? candidate.name || '' : candidate.tags?.name || ''
    const candidateSource = 'place_id' in candidate ? 'google' : 'osm'

    // Calculate name similarity
    const nameSimilarity = calculateNameSimilarity(
      targetPlace.tags?.name || '',
      candidateName,
    )

    // Hard threshold - if names are too dissimilar, don't match regardless of distance
    const MIN_NAME_SIMILARITY = 0.7
    if (nameSimilarity < MIN_NAME_SIMILARITY) {
      return {
        googlePlace:
          'place_id' in candidate
            ? (candidate as unknown as GooglePlaceDetails)
            : undefined,
        osmPlace: 'type' in candidate ? (candidate as Place) : undefined,
        similarity: 0,
        distance: Infinity,
      }
    }

    // Calculate geographic distance using Turf
    let distanceMeters = Infinity
    if (targetPoint && coordinates) {
      let candidatePoint

      if ('center' in candidate && candidate.center) {
        // OSM place
        candidatePoint = turf.point([
          candidate.center.lon,
          candidate.center.lat,
        ])
      } else if ('geometry' in candidate && candidate.geometry) {
        // Google place with location property
        const googleCandidate = candidate as GooglePlaceDetails
        if (
          googleCandidate.geometry &&
          'location' in googleCandidate.geometry
        ) {
          const location = googleCandidate.geometry.location
          candidatePoint = turf.point([location.lng, location.lat])
        }
      }

      if (candidatePoint) {
        distanceMeters = turf.distance(targetPoint, candidatePoint) * 1000 // Convert km to meters
      }
    }

    // Distance-based scores with stricter name similarity requirements
    let geographicScore = 0

    if (distanceMeters < 50) {
      // Very close, but still require higher name similarity
      if (nameSimilarity >= 0.8) {
        geographicScore = 0.8
      } else {
        geographicScore = 0.05 // Reduced from 0.1 to 0.05 for close places with dissimilar names
      }
    } else if (distanceMeters < 100) {
      // Close, but require stronger name similarity
      if (nameSimilarity >= 0.85) {
        geographicScore = 0.6
      } else {
        geographicScore = 0.05 // Kept at 0.05
      }
    } else if (distanceMeters < 200) {
      // Moderate distance, require high name similarity
      if (nameSimilarity >= 0.9) {
        geographicScore = 0.4
      } else {
        geographicScore = 0.02 // Kept at 0.02
      }
    } else {
      // Far away, needs very strong evidence to match
      geographicScore = Math.max(0, 0.5 - distanceMeters / 1000)
    }

    // The overall score is a combination of name similarity and geographic score
    // Higher weight on name similarity (0.95) and lower on geographic proximity (0.05)
    const score = nameSimilarity * 0.95 + geographicScore * 0.05 // Changed from 0.9/0.1 to 0.95/0.05

    return {
      googlePlace:
        'place_id' in candidate
          ? (candidate as unknown as GooglePlaceDetails)
          : undefined,
      osmPlace: 'type' in candidate ? (candidate as Place) : undefined,
      similarity: score,
      distance: distanceMeters,
    }
  })

  // Sort by score, descending
  candidatesWithScores.sort((a, b) => b.similarity - a.similarity)

  // Log the top candidates for debugging
  console.log('Top match candidates:')
  candidatesWithScores
    .slice(0, 3)
    .forEach(({ osmPlace, googlePlace, similarity, distance }) => {
      const name = osmPlace
        ? osmPlace.tags?.name
        : googlePlace
        ? googlePlace.name
        : 'Unknown'
      const type = osmPlace ? osmPlace.type : googlePlace ? 'google' : 'unknown'
      console.log(
        `- "${name}" (from ${type}): score=${similarity.toFixed(
          3,
        )}, distance=${distance.toFixed(0)}m`,
      )
    })

  // Return the best match if it exceeds our threshold
  const bestMatch = candidatesWithScores[0]
  const MATCH_THRESHOLD = 0.85 // Increased from 0.8 to 0.85 as an additional safeguard

  if (bestMatch && bestMatch.similarity >= MATCH_THRESHOLD) {
    // Extract name from either Google or OSM data
    const name = bestMatch.osmPlace
      ? bestMatch.osmPlace.tags?.name
      : bestMatch.googlePlace
      ? bestMatch.googlePlace.name
      : 'Unknown'

    // Return list of candidates (either OSM or Google places)
    if (bestMatch.osmPlace) {
      return [bestMatch]
    } else if (bestMatch.googlePlace) {
      // Create a simplified Place object from GooglePlaceDetails
      const googlePlace = bestMatch.googlePlace
      const placeLike: Place = {
        id: (
          parseInt(googlePlace.place_id.substring(0, 8), 16) || 0
        ).toString(), // Generate a numeric ID from first part of place_id
        type: 'node', // Assume it's a node for simplicity
        tags: {
          name: googlePlace.name,
          // Add more tags as needed
        },
        center: {
          lat: googlePlace.geometry?.location?.lat || 0,
          lon: googlePlace.geometry?.location?.lng || 0,
        },
      }
      return [
        {
          googlePlace: googlePlace,
          osmPlace: placeLike,
          similarity: bestMatch.similarity,
          distance: bestMatch.distance,
        },
      ]
    }
  }

  return []
}

/**
 * Search for places using configured integrations
 */
export const searchPlaces = async (
  query: string,
  userId: string | null,
  coordinates?: { lat: number; lng: number },
  radius: number = 1000,
): Promise<PlaceSearchResult[]> => {
  try {
    console.log(
      `Searching for "${query}" with radius ${radius}m${
        coordinates
          ? ` at coordinates (${coordinates.lat}, ${coordinates.lng})`
          : ''
      }`,
    )

    // Step 1: Collect all places from different sources
    const allPlaces: UnifiedPlace[] = []

    // Step 1a: Get places from configured integrations with PLACE_INFO capability
    try {
      const placeInfoIntegrations =
        integrationManager.getIntegrationsByCapability(
          IntegrationCapabilityId.PLACE_INFO,
        )

      if (placeInfoIntegrations.length > 0) {
        console.log(
          `Found ${placeInfoIntegrations.length} active integrations with capability: ${IntegrationCapabilityId.PLACE_INFO}`,
        )

        const placeInfoResults = await Promise.all(
          placeInfoIntegrations.map(async (cachedIntegration) => {
            try {
              const integration = cachedIntegration.integration as any

              if (typeof integration.searchPlaces !== 'function') {
                console.warn(
                  `Integration ${cachedIntegration.integrationId} does not implement searchPlaces`,
                )
                return []
              }

              console.log(`Searching using ${cachedIntegration.integrationId}`)
              const integrationResults = await integration.searchPlaces(
                query,
                coordinates?.lat,
                coordinates?.lng,
                radius,
              )

              return integrationResults.map((result: any) => ({
                ...result,
                source: cachedIntegration.integrationId,
              }))
            } catch (error) {
              console.error(
                `Error with ${cachedIntegration.integrationId}:`,
                error,
              )
              return []
            }
          }),
        )

        const flatResults = placeInfoResults.flat()
        console.log(
          `Found ${flatResults.length} places from PLACE_INFO integrations`,
        )

        // Convert integration results to UnifiedPlace objects
        for (const result of flatResults) {
          // Skip results without required data
          if (
            !result.name ||
            (!result.lat && !result.lng && !result.geometry)
          ) {
            continue
          }

          // Get the integration that provided this result
          const sourceIntegration = integrationManager.getIntegrationForSource(
            result.source,
            IntegrationCapabilityId.PLACE_INFO,
          )

          // Create UnifiedPlace object from result data
          if (sourceIntegration) {
            // Use the integration's createUnifiedPlace method
            const unifiedPlace =
              sourceIntegration.integration.createUnifiedPlace(result)
            if (unifiedPlace) {
              allPlaces.push(unifiedPlace)
            }
          } else {
            console.error(
              `No integration found for source: ${result.source}. Skipping result.`,
            )
          }
        }
      } else {
        console.log(
          `No active integrations found with capability: ${IntegrationCapabilityId.PLACE_INFO}`,
        )
      }
    } catch (error) {
      console.error(
        'Error fetching places from PLACE_INFO integrations:',
        error,
      )
    }

    // Step 1b: Get places from configured integrations with GEOCODING capability
    try {
      const geocodingIntegrations =
        integrationManager.getIntegrationsByCapability(
          IntegrationCapabilityId.GEOCODING,
        )

      if (geocodingIntegrations.length > 0) {
        console.log(
          `Found ${geocodingIntegrations.length} active integrations with capability: ${IntegrationCapabilityId.GEOCODING}`,
        )

        const geocodingResults = await Promise.all(
          geocodingIntegrations.map(async (cachedIntegration) => {
            try {
              const integration = cachedIntegration.integration as any

              if (typeof integration.searchPlaces !== 'function') {
                console.warn(
                  `Integration ${cachedIntegration.integrationId} does not implement searchPlaces`,
                )
                return []
              }

              console.log(`Searching using ${cachedIntegration.integrationId}`)
              const integrationResults = await integration.searchPlaces(
                query,
                coordinates?.lat,
                coordinates?.lng,
                radius,
              )

              return integrationResults.map((result: any) => ({
                ...result,
                source: cachedIntegration.integrationId,
              }))
            } catch (error) {
              console.error(
                `Error with ${cachedIntegration.integrationId}:`,
                error,
              )
              return []
            }
          }),
        )

        const flatResults = geocodingResults.flat()
        console.log(
          `Found ${flatResults.length} places from GEOCODING integrations`,
        )

        // Convert integration results to UnifiedPlace objects
        for (const result of flatResults) {
          // Skip results without required data
          if (
            !result.name ||
            (!result.lat && !result.lng && !result.geometry)
          ) {
            continue
          }

          // Get the integration that provided this result
          const sourceIntegration = integrationManager.getIntegrationForSource(
            result.source,
            IntegrationCapabilityId.GEOCODING,
          )

          // Create UnifiedPlace object from result data
          if (sourceIntegration) {
            // Use the integration's createUnifiedPlace method
            const unifiedPlace =
              sourceIntegration.integration.createUnifiedPlace(result)
            if (unifiedPlace) {
              allPlaces.push(unifiedPlace)
            }
          } else {
            console.error(
              `No integration found for source: ${result.source}. Skipping result.`,
            )
          }
        }
      } else {
        console.log(
          `No active integrations found with capability: ${IntegrationCapabilityId.GEOCODING}`,
        )
      }
    } catch (error) {
      console.error('Error fetching places from GEOCODING integrations:', error)
    }

    // Step 2: Deduplicate places
    console.log(`Deduplicating ${allPlaces.length} places...`)
    const dedupedPlaces = deduplicatePlacesResults(allPlaces)
    console.log(`After deduplication: ${dedupedPlaces.length} unique places`)

    // Step 3: Add bookmark information if user ID is provided
    if (userId) {
      await addBookmarkInfo(dedupedPlaces, userId)
    }

    // Step 4: Convert UnifiedPlace objects to PlaceSearchResult objects
    const results = dedupedPlaces.map((place) => createSearchResult(place))

    // Step 5: Calculate distances and sort results
    if (coordinates) {
      // Create the from point once outside the sort function
      const fromPoint = turf.point([coordinates.lng, coordinates.lat])

      // First calculate distances for each result
      results.forEach((result) => {
        const toPoint = turf.point([
          result.geometry.center.lng,
          result.geometry.center.lat,
        ])
        result.distance = turf.distance(fromPoint, toPoint, { units: 'meters' })
      })

      // Sort by distance
      results.sort(
        (a, b) => (a.distance || Infinity) - (b.distance || Infinity),
      )
    }

    console.log(`Returning ${results.length} search results`)
    return results
  } catch (error) {
    console.error('Error searching for places:', error)
    return []
  }
}

/**
 * Helper function to deduplicate places based on similarity and proximity
 *
 * This function identifies duplicate places by using:
 * 1. Name similarity - Using a specialized name comparison algorithm that
 *    handles variations in business names, building names, etc.
 * 2. Geographic proximity - Places that are close together (with distance
 *    thresholds that vary based on name similarity)
 *
 * When duplicates are found, their data is merged with the following approach:
 * - External IDs from all sources are preserved
 * - Source references are combined
 * - The most complete/detailed data is kept for fields like address and contact info
 * - Photos are deduplicated and combined
 *
 * We do NOT use external IDs for deduplication since different data providers
 * assign their own unique IDs to the same real-world places.
 */
// Using deduplicateAutocompletePlaces from merge.service instead of a custom implementation

/**
 * Add bookmark information to places
 */
async function addBookmarkInfo(
  places: UnifiedPlace[],
  userId: string,
): Promise<void> {
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
): Promise<UnifiedPlace[]> => {
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
        turf.point([a.geometry.center.lng, a.geometry.center.lat]),
        { units: 'meters' },
      )
      const distanceB = turf.distance(
        fromPoint,
        turf.point([b.geometry.center.lng, b.geometry.center.lat]),
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
): Promise<UnifiedPlace[]> {
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

        // Transform each prediction into a UnifiedPlace
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
): Promise<UnifiedPlace | null> {
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
 * @returns Array of UnifiedPlace objects from all providers
 */
export async function lookupPlacesByNameAndLocation(
  name: string,
  coordinates: { lat: number; lng: number },
  options?: {
    radius?: number
    sourceBlacklist?: Source[]
  },
): Promise<UnifiedPlace[]> {
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

        // Transform each result to a UnifiedPlace
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
            turf.point([a.geometry.center.lng, a.geometry.center.lat]),
          )
          const distanceB = turf.distance(
            fromPoint,
            turf.point([b.geometry.center.lng, b.geometry.center.lat]),
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
 * @returns A deduplicated UnifiedPlace object
 */
export async function lookupPlaceByNameAndLocation(
  name: string,
  coordinates: { lat: number; lng: number },
  options?: {
    userId?: string
    radius?: number
    sourceBlacklist?: Source[]
  },
): Promise<UnifiedPlace | null> {
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
 * @returns A merged UnifiedPlace object with consolidated data from multiple sources
 */
export async function lookupAndMergePlaceById(
  source: Source,
  id: string,
  options?: {
    userId?: string
  },
): Promise<UnifiedPlace | null> {
  try {
    const { userId } = options || {}

    // First, get the place from the primary source
    let place = await lookupPlaceById(source, id)
    if (!place) return null

    // If place has name and location, try to find it in other sources
    if (place.name && place.geometry?.center) {
      const { lat, lng } = place.geometry.center

      const thirdPartyPlace = await lookupPlaceByNameAndLocation(
        place.name,
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
