import type { Place, GooglePlaceDetails } from '../types/place.types'
import type {
  UnifiedPlace,
  PlaceGeometry,
  Address,
  PlacePhoto,
  SourceReference,
} from '../types/unified-place.types'
import { getPlaceType } from '../lib/place.utils'
import { searchGooglePlace, searchGooglePlaces } from './external-api.service'
import { GOOGLE_PLACES_API_URL } from '../lib/constants'
import { deduplicateAutocompletePlaces, mergePlaceData } from './merge.service'
import { fetchPlaceFromOverpass, searchOverpass } from './osm.service'
import { fetchWikidataImage, fetchWikidataBrandLogo } from './wikidata.service'
import { googleAdapter } from '../adapters/google-adapter'
import { API_CONFIG, SOURCE } from '../lib/constants'
import { osmAdapter } from '../adapters/osm-adapter'
import axios from 'axios'
import type { Bookmark } from '../types/library.types'
import { findBookmarkByExternalIds } from './library/bookmarks.service'
import * as turf from '@turf/turf'
import { integrationManager } from './integrations'
import { IntegrationCapabilityId } from '../types/integration.types'

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

/**
 * Generates a base unified place object from an OSM place
 */
function createBaseUnifiedPlace(
  place: Place,
  name: string,
  placeType: string,
): UnifiedPlace {
  return {
    id: place.id,
    externalIds: { [SOURCE.OSM]: place.id.toString() },
    name: name,
    placeType: placeType,
    geometry: createGeometry(place),
    photos: [],
    address: null,
    contactInfo: {
      phone: null,
      email: null,
      website: null,
      socials: {},
    },
    openingHours: null,
    amenities: {},
    sources: [],
    lastUpdated: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  }
}

function createGeometry(place: Place): PlaceGeometry {
  return {
    type: place.type === 'node' ? 'point' : 'polygon',
    center: {
      lat: place.center!.lat,
      lng: place.center!.lon,
    },
    ...(place.bounds && {
      bounds: {
        minLat: place.bounds.minlat,
        minLng: place.bounds.minlon,
        maxLat: place.bounds.maxlat,
        maxLng: place.bounds.maxlon,
      },
    }),
    ...(place.geometry && {
      nodes: place.geometry.map((node) => ({
        lat: node.lat,
        lng: node.lon,
      })),
    }),
  }
}

async function fetchExternalData(
  name: string,
  center: { lat: number; lon: number },
  place: Place,
) {
  const promises: Promise<any>[] = []

  if (API_CONFIG[SOURCE.GOOGLE]) {
    promises.push(searchGooglePlace(name, center.lat, center.lon, place))
  }

  if (API_CONFIG[SOURCE.WIKIDATA]) {
    const wikidataId = place.tags?.wikidata || place.tags?.['brand:wikidata']
    promises.push(
      Promise.all([
        fetchWikidataImage(wikidataId),
        fetchWikidataBrandLogo(wikidataId),
      ]),
    )
  }

  return Promise.all(promises)
}

export const getPlaceDetails = async (
  id: string,
  userId: string | null,
): Promise<UnifiedPlace | null> => {
  try {
    const place = await fetchPlaceFromOverpass(id)

    if (!place) {
      console.error('Could not fetch place from Overpass')
      return null
    }

    console.log('Raw place data:', JSON.stringify(place, null, 2))

    if (!place.center) {
      console.error('Place data missing center coordinates:', place)
      return null
    }

    const name = place.tags?.name || place.tags?.['brand:name'] || ''
    const placeType = getPlaceType(place.tags || {})

    console.log(`Creating base unified place from OSM: ${name}`)
    const unifiedPlace = createBaseUnifiedPlace(place, name, placeType)

    // Add OSM data first
    console.log('Adding OSM data')
    mergePlaceData(unifiedPlace, osmAdapter, place)

    // Then fetch and add external data
    const externalData = await fetchExternalData(name, place.center, place)
    let currentIndex = 0

    // Add Google data if enabled (OSM will still have priority)
    if (API_CONFIG[SOURCE.GOOGLE]) {
      const googleData = externalData[currentIndex] as GooglePlaceDetails | null
      if (googleData) {
        console.log(`Adding Google data: ${googleData.name}`)
        mergePlaceData(unifiedPlace, googleAdapter, googleData)
      } else {
        console.log('No Google data found')
      }
      currentIndex++
    }

    // Add Wikidata
    if (API_CONFIG[SOURCE.WIKIDATA]) {
      const [image, logo] = externalData[currentIndex] as [
        string | null,
        string | null,
      ]

      if (image) {
        console.log('Adding Wikidata image')
        unifiedPlace.photos.push({
          url: image,
          sourceId: SOURCE.WIKIDATA,
          isPrimary: true,
        })
      }

      if (logo) {
        console.log('Adding Wikidata logo')
        unifiedPlace.photos.push({
          url: logo,
          sourceId: SOURCE.WIKIDATA,
          isLogo: true,
        })
      }
    }

    // Find associated bookmark
    if (userId && unifiedPlace.externalIds) {
      const bookmarkInfo = await findBookmarkByExternalIds(
        unifiedPlace.externalIds,
        userId,
      )
      if (bookmarkInfo) {
        unifiedPlace.bookmark = bookmarkInfo.bookmark
        unifiedPlace.collectionIds = bookmarkInfo.collectionIds
      }
    }

    return unifiedPlace
  } catch (error) {
    console.error('Error getting place details:', error)
    return null
  }
}

// Export calculateNameSimilarity for use in merge.service.ts
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
          const sourceIntegration = integrationManager.getIntegrationBySourceId(
            result.source,
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
          const sourceIntegration = integrationManager.getIntegrationBySourceId(
            result.source,
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
    const dedupedPlaces = deduplicateAutocompletePlaces(allPlaces, coordinates)
    console.log(`After deduplication: ${dedupedPlaces.length} unique places`)

    // Step 3: Add bookmark information if user ID is provided
    if (userId) {
      await addBookmarkInfo(dedupedPlaces, userId)
    }

    // Step 4: Convert UnifiedPlace objects to PlaceSearchResult objects
    const results = dedupedPlaces.map((place) => createSearchResult(place))

    // Step 5: Calculate distances and sort results
    if (coordinates) {
      results.forEach((result) => {
        // TODO: Replace with turf.js distance
        const distance = calculateDistance(coordinates, result.geometry.center)
        result.distance = distance
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

// TODO: Remove
/**
 * Calculate distance between two points in meters
 */
function calculateDistance(point1: any, point2: any): number {
  try {
    const from = turf.point([point1.lng, point1.lat])
    const to = turf.point([point2.lng, point2.lat])
    return turf.distance(from, to, { units: 'meters' })
  } catch (error) {
    console.error('Error calculating distance:', error)
    return Infinity
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

  const deduped = deduplicateAutocompletePlaces(
    autocompleteResults,
    coordinates,
  )

  if (coordinates) {
    deduped.sort((a, b) => {
      const distanceA = calculateDistance(coordinates, a.geometry.center)
      const distanceB = calculateDistance(coordinates, b.geometry.center)
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

// Get a place's details by its provider ID
export const getPlaceDetailsByProviderId = async (
  provider: string,
  id: string,
  userId: string | null,
): Promise<UnifiedPlace | null> => {
  try {
    console.log(
      `Getting place details by provider ID - Provider: "${provider}", ID: "${id}"`,
    )

    // Factory pattern - dispatch to the appropriate handler based on provider
    switch (provider) {
      case SOURCE.GOOGLE:
        return getPlaceDetailsByGoogleId(id, userId)
      case SOURCE.PELIAS:
        return getPlaceDetailsByPeliasId(id, userId)
      // Add more provider cases as needed
      default:
        console.error(`Unsupported provider: ${provider}`)
        return null
    }
  } catch (error) {
    console.error(`Error getting place details by ${provider} ID:`, error)
    return null
  }
}

// TODO: Remove this
// Google ID-specific implementation
async function getPlaceDetailsByGoogleId(
  googleId: string,
  userId: string | null,
): Promise<UnifiedPlace | null> {
  try {
    console.log(`Inside getPlaceDetailsByGoogleId with ID: "${googleId}"`)

    // Log the entire route that would be returned by the getPlaceRoute function
    console.log(
      `This ID would create a route to: provider=google, placeId=${googleId}`,
    )

    // Fetch place details from Google
    const googlePlace = await fetchGooglePlaceById(googleId)

    if (!googlePlace) {
      console.log(`fetchGooglePlaceById returned null for ID: "${googleId}"`)
      return null
    }

    console.log(`Successfully fetched Google place: "${googlePlace.name}"`)

    // Create a unified place from Google data
    const unifiedPlace: UnifiedPlace = {
      id: `google/${googleId}`,
      externalIds: { [SOURCE.GOOGLE]: googleId },
      name: googlePlace.name,
      placeType: googlePlace.types[0] || 'unknown',
      geometry: {
        type: 'point',
        center: {
          lat: googlePlace.geometry?.location.lat || 0,
          lng: googlePlace.geometry?.location.lng || 0,
        },
      },
      photos: [],
      address: googlePlace.formatted_address
        ? {
            formatted: googlePlace.formatted_address,
          }
        : null,
      contactInfo: {
        phone: null,
        email: null,
        website: null,
        socials: {},
      },
      openingHours: null,
      amenities: {},
      sources: [],
      lastUpdated: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    }

    // First, add Google data
    console.log(`Adding Google data for: ${googlePlace.name}`)
    mergePlaceData(unifiedPlace, googleAdapter, googlePlace)

    // Then try to find and merge OSM data to ensure OSM takes priority
    if (googlePlace.geometry?.location) {
      const { lat, lng } = googlePlace.geometry.location
      console.log(
        `Looking for matching OSM places near: lat=${lat}, lng=${lng}`,
      )

      const osmPlaces = await searchOverpass(googlePlace.name, lat, lng, 300)

      if (osmPlaces.length > 0) {
        console.log(
          `Found ${
            osmPlaces.length
          } potential OSM matches, using the first one: ${
            osmPlaces[0].tags?.name || 'unnamed'
          }`,
        )

        // Since we're adding OSM data after Google, and OSM has higher priority,
        // fields that exist in both will use the OSM values due to priority system
        mergePlaceData(unifiedPlace, osmAdapter, osmPlaces[0])

        // Update the ID to use the OSM ID if available
        if (osmPlaces[0].type && osmPlaces[0].id) {
          const oldId = unifiedPlace.id
          unifiedPlace.id = `${osmPlaces[0].type}/${osmPlaces[0].id}`
          unifiedPlace.externalIds[SOURCE.OSM] = osmPlaces[0].id.toString()
          console.log(
            `Updated place ID from ${oldId} to ${unifiedPlace.id} based on OSM data`,
          )
        }
      } else {
        console.log(`No matching OSM places found. Using Google data only.`)
      }
    }

    // Find associated bookmark
    if (userId && unifiedPlace.externalIds) {
      const bookmarkInfo = await findBookmarkByExternalIds(
        unifiedPlace.externalIds,
        userId,
      )
      if (bookmarkInfo) {
        unifiedPlace.bookmark = bookmarkInfo.bookmark
        unifiedPlace.collectionIds = bookmarkInfo.collectionIds
      }
    }

    return unifiedPlace
  } catch (error) {
    console.error('Error getting place details by Google ID:', error)
    return null
  }
}

// TODO: Remove this
// Pelias ID-specific implementation
async function getPlaceDetailsByPeliasId(
  peliasId: string,
  userId: string | null,
): Promise<UnifiedPlace | null> {
  try {
    console.log(`Getting place details by Pelias ID: "${peliasId}"`)

    // Pelias IDs should be in OSM format (way/123456, node/123456, relation/123456)
    // If the ID starts with "way/", "node/", or "relation/", use it directly
    // Otherwise, try to parse it from the OpenStreetMap ID format

    let osmId = peliasId

    // Check if we need to extract the OSM ID from a Pelias format (which might include source prefix)
    if (peliasId.includes(':')) {
      const parts = peliasId.split(':')
      if (parts.length > 1) {
        // Format could be "openstreetmap:venue:way/123456"
        const lastPart = parts[parts.length - 1]
        if (lastPart.includes('/')) {
          osmId = lastPart
        }
      }
    }

    // Once we have the OSM ID, use our existing getPlaceDetails function
    console.log(`Using OSM ID for lookup: "${osmId}"`)
    return getPlaceDetails(osmId, userId)
  } catch (error) {
    console.error('Error getting place details by Pelias ID:', error)
    return null
  }
}

// TODO: Review this function
export const getPlaceDetailsByNameAndLocation = async (
  name: string,
  coordinates: { lat: number; lng: number },
  userId: string | null,
  radius: number = 500,
): Promise<UnifiedPlace | null> => {
  try {
    const promises: Promise<any>[] = []

    promises.push(
      searchOverpass(name, coordinates.lat, coordinates.lng, radius),
    )

    if (API_CONFIG[SOURCE.GOOGLE]) {
      promises.push(
        searchGooglePlaces(name, coordinates.lat, coordinates.lng, radius),
      )
    }

    const results = await Promise.all(promises)

    const osmPlaces = results[0] || []
    let googlePlaces: GooglePlaceDetails[] = []

    if (API_CONFIG[SOURCE.GOOGLE]) {
      googlePlaces = results[1] || []
    }

    // Match and bucket results
    const candidates = matchPlaceCandidates(
      osmPlaces[0],
      googlePlaces,
      coordinates,
    )

    if (candidates.length === 0) {
      return null
    }

    const bestCandidate = candidates[0]

    let unifiedPlace: UnifiedPlace

    // Prioritize OSM data - if we have an OSM place, start with that
    if (bestCandidate.osmPlace) {
      const osmPlace = bestCandidate.osmPlace
      const placeName =
        osmPlace.tags?.name || osmPlace.tags?.['brand:name'] || name
      const placeType = getPlaceType(osmPlace.tags || {})

      unifiedPlace = createBaseUnifiedPlace(osmPlace, placeName, placeType)

      // First add OSM data
      mergePlaceData(unifiedPlace, osmAdapter, osmPlace)

      // Then add Google data (OSM fields will be preserved due to priority)
      if (bestCandidate.googlePlace) {
        mergePlaceData(unifiedPlace, googleAdapter, bestCandidate.googlePlace)
      }
    }
    // If no OSM data, fall back to Google
    else if (bestCandidate.googlePlace) {
      const googlePlace = bestCandidate.googlePlace

      unifiedPlace = {
        id: `google/${googlePlace.place_id}`,
        externalIds: { [SOURCE.GOOGLE]: googlePlace.place_id },
        name: googlePlace.name,
        placeType: googlePlace.types[0] || 'unknown',
        geometry: {
          type: 'point',
          center: {
            lat: googlePlace.geometry?.location.lat || 0,
            lng: googlePlace.geometry?.location.lng || 0,
          },
        },
        photos: [],
        address: null,
        contactInfo: {
          phone: null,
          email: null,
          website: null,
          socials: {},
        },
        openingHours: null,
        amenities: {},
        sources: [],
        lastUpdated: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      }

      mergePlaceData(unifiedPlace, googleAdapter, googlePlace)
    } else {
      return null
    }

    // Find associated bookmark
    if (userId && unifiedPlace.externalIds) {
      const bookmarkInfo = await findBookmarkByExternalIds(
        unifiedPlace.externalIds,
        userId,
      )
      if (bookmarkInfo) {
        unifiedPlace.bookmark = bookmarkInfo.bookmark
        unifiedPlace.collectionIds = bookmarkInfo.collectionIds
      }
    }

    return unifiedPlace
  } catch (error) {
    console.error('Error getting place details by name and location:', error)
    return null
  }
}

// TODO: Review this function
async function fetchGooglePlaceById(
  placeId: string,
): Promise<GooglePlaceDetails | null> {
  try {
    // Debug information about the ID
    console.log(`Fetching Google place by ID: ${placeId}`)
    console.log(`Raw placeId provided: "${placeId}"`)

    // Clean up the Place ID
    let cleanPlaceId = placeId

    // 1. Strip the 'google/' prefix if it exists
    if (cleanPlaceId.startsWith('google/')) {
      cleanPlaceId = cleanPlaceId.substring(7)
      console.log(`Stripped 'google/' prefix, using ID: "${cleanPlaceId}"`)
    }

    // 2. Handle potential double-prefixing (e.g., "google/google/ChIJ...")
    if (cleanPlaceId.startsWith('google/')) {
      cleanPlaceId = cleanPlaceId.substring(7)
      console.log(
        `Found another 'google/' prefix, now using ID: "${cleanPlaceId}"`,
      )
    }

    console.log(`Final cleaned place ID: "${cleanPlaceId}"`)
    console.log(
      `Using Google Maps API key: ${
        process.env.GOOGLE_MAPS_API_KEY ? 'Key is set' : 'Key is missing!'
      }`,
    )
    console.log(
      `API key first few chars: ${
        process.env.GOOGLE_MAPS_API_KEY
          ? process.env.GOOGLE_MAPS_API_KEY.substring(0, 5) + '...'
          : 'missing'
      }`,
    )

    // Use the GET endpoint instead of searchText
    console.log(`Making request to get details for place ID: ${cleanPlaceId}`)
    const endpoint = `${GOOGLE_PLACES_API_URL}/${cleanPlaceId}`
    console.log(`Request URL: ${endpoint}`)

    const response = await axios.get(endpoint, {
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask':
          'id,displayName,formattedAddress,internationalPhoneNumber,websiteUri,types,photos,rating,userRatingCount,googleMapsUri,priceLevel,businessStatus,editorialSummary,location,dineIn,takeout,delivery,curbsidePickup,servesBreakfast,servesLunch,servesDinner,servesBeer,servesVegetarianFood,servesCocktails,servesCoffee,outdoorSeating,liveMusic,goodForChildren,goodForGroups,restroom,regularOpeningHours,utcOffsetMinutes',
      },
    })

    console.log('Google Places API response status:', response.status)
    console.log(
      'Google Places API response data structure:',
      Object.keys(response.data),
    )

    if (!response.data || Object.keys(response.data).length === 0) {
      console.error('No place details returned for the given Google Place ID')
      console.error(`Attempted to find place with ID: ${cleanPlaceId}`)
      return null
    }

    console.log(
      'Complete Google Places API response:',
      JSON.stringify(response.data, null, 2),
    )

    // Transform the response data into our GooglePlaceDetails format
    const transformedPlace = {
      place_id: response.data.id,
      name: response.data.displayName?.text || '',
      formatted_address: response.data.formattedAddress || '',
      formatted_phone_number: response.data.internationalPhoneNumber || '',
      website: response.data.websiteUri || '',
      types: response.data.types || [],
      photos:
        response.data.photos?.map(
          (photo: { name: string; heightPx?: number; widthPx?: number }) => ({
            photo_reference: photo.name,
            height: photo.heightPx || 0,
            width: photo.widthPx || 0,
            html_attributions: [],
          }),
        ) || [],
      rating: response.data.rating || 0,
      user_ratings_total: response.data.userRatingCount || 0,
      google_maps_uri: response.data.googleMapsUri || '',
      price_level: response.data.priceLevel || '',
      business_status: response.data.businessStatus || '',
      editorial_summary: response.data.editorialSummary
        ? {
            language: response.data.editorialSummary.languageCode || undefined,
            overview:
              response.data.editorialSummary.text ||
              response.data.editorialSummary.overview ||
              '',
          }
        : undefined,
      geometry: response.data.location
        ? {
            location: {
              lat: response.data.location.latitude,
              lng: response.data.location.longitude,
            },
          }
        : undefined,
      opening_hours: response.data.regularOpeningHours
        ? {
            open_now: response.data.regularOpeningHours.openNow || false,
            periods: response.data.regularOpeningHours.periods || [],
            weekday_text:
              response.data.regularOpeningHours.weekdayDescriptions || [],
          }
        : undefined,
      dine_in: response.data.dineIn || false,
      takeout: response.data.takeout || false,
      delivery: response.data.delivery || false,
      curbside_pickup: response.data.curbsidePickup || false,
      serves_breakfast: response.data.servesBreakfast || false,
      serves_lunch: response.data.servesLunch || false,
      serves_dinner: response.data.servesDinner || false,
      serves_beer: response.data.servesBeer || false,
      serves_vegetarian: response.data.servesVegetarianFood || false,
      serves_cocktails: response.data.servesCocktails || false,
      serves_coffee: response.data.servesCoffee || false,
      outdoor_seating: response.data.outdoorSeating || false,
      live_music: response.data.liveMusic || false,
      good_for_children: response.data.goodForChildren || false,
      good_for_groups: response.data.goodForGroups || false,
      restroom: response.data.restroom || false,
      utc_offset: response.data.utcOffsetMinutes || 0,
    }

    console.log(
      'Transformed place details:',
      JSON.stringify(transformedPlace, null, 2),
    )

    return transformedPlace
  } catch (error: any) {
    console.error('Error fetching Google place by ID:', error.message || error)
    if (axios.isAxiosError(error) && error.response) {
      console.error('Error response status:', error.response.status)
      console.error(
        'Error response data:',
        JSON.stringify(error.response.data, null, 2),
      )
    }
    return null
  }
}
