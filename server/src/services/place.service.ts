import type { Place, GooglePlaceDetails } from '../types/place.types'
import type {
  UnifiedPlace,
  AttributedValue,
  PlaceGeometry,
  Address,
  OpeningHours,
  PlacePhoto,
  SourceReference,
} from '../types/unified-place.types'
import { getPlaceType } from '../lib/place.utils'
import {
  searchGooglePlace,
  GOOGLE_PLACES_API_URL,
  GOOGLE_MAPS_PHOTO_URL,
  searchGooglePlaces,
  getGooglePlacesAutocomplete,
  AutocompletePrediction,
} from './external-api.service'
import {
  mergeAttributedValues,
  selectBestValue,
  getTimestamp,
} from './merge.service'
import {
  fetchPlaceFromOverpass,
  searchOverpass,
  searchNominatim,
} from './osm.service'
import { fetchWikidataImage, fetchWikidataBrandLogo } from './wikidata.service'
import { parseGoogleHours, parseOsmHours } from '../lib/hours.utils'
import { googleAdapter } from '../adapters/google-adapter'
import type { PlaceDataAdapter } from '../types/adapter.types'
import { API_CONFIG, SOURCE } from '../lib/constants'
import { osmAdapter } from '../adapters/osm-adapter'

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
}

// New interface to represent a place candidate before merging
interface PlaceCandidate {
  osmPlace?: Place
  googlePlace?: GooglePlaceDetails
  similarity: number
  distance: number
}

function mergePlaceData(
  unifiedPlace: UnifiedPlace,
  adapter: PlaceDataAdapter,
  data: any,
) {
  if (!data) return

  try {
    const transformed = adapter.transform(data)

    // Use the timestamp from the source data if available (for OSM)
    // otherwise use the current timestamp
    const timestamp =
      adapter.sourceId === SOURCE.OSM && data.timestamp
        ? data.timestamp
        : getTimestamp()

    // Add source ID to externalIds if it exists
    if (adapter.sourceId === SOURCE.GOOGLE && 'place_id' in data) {
      unifiedPlace.externalIds[adapter.sourceId] = data.place_id
    } else if (adapter.sourceId === SOURCE.OSM && 'id' in data) {
      unifiedPlace.externalIds[adapter.sourceId] = data.id.toString()
    }

    // Name
    if (transformed.name) {
      unifiedPlace.name =
        selectBestValue([
          ...(unifiedPlace.name
            ? [{ value: unifiedPlace.name, sourceId: 'existing', timestamp }]
            : []),
          transformed.name,
        ]) ||
        unifiedPlace.name ||
        ''
    }

    // Description
    if (transformed.description) {
      // If we don't have a description yet or if OSM provides a description, use it
      if (!unifiedPlace.description || adapter.sourceId === SOURCE.OSM) {
        unifiedPlace.description = transformed.description.value
      }
    }

    // Address
    if (transformed.address) {
      // If we don't have an address yet, or if OSM provides an address, use it
      if (
        !unifiedPlace.address ||
        !unifiedPlace.address.formatted ||
        adapter.sourceId === SOURCE.OSM
      ) {
        unifiedPlace.address = transformed.address.value
      }
    }

    // Contact Info
    if (transformed.contactInfo) {
      const { phone, email, website, socials } = transformed.contactInfo

      // Handle phone number
      if (
        phone &&
        (!unifiedPlace.contactInfo.phone || adapter.sourceId === SOURCE.OSM)
      ) {
        unifiedPlace.contactInfo.phone = phone
      }

      // Handle email
      if (
        email &&
        (!unifiedPlace.contactInfo.email || adapter.sourceId === SOURCE.OSM)
      ) {
        unifiedPlace.contactInfo.email = email
      }

      // Handle website
      if (
        website &&
        (!unifiedPlace.contactInfo.website || adapter.sourceId === SOURCE.OSM)
      ) {
        unifiedPlace.contactInfo.website = website
      }

      // Handle social media links
      if (socials && Object.keys(socials).length > 0) {
        // Merge social media links
        Object.entries(socials).forEach(([platform, value]) => {
          if (
            !unifiedPlace.contactInfo.socials[platform] ||
            adapter.sourceId === SOURCE.OSM
          ) {
            unifiedPlace.contactInfo.socials[platform] = value
          }
        })
      }
    }

    // Opening Hours
    if (transformed.openingHours) {
      if (
        !unifiedPlace.openingHours ||
        !unifiedPlace.openingHours.regularHours?.length ||
        adapter.sourceId === SOURCE.OSM
      ) {
        unifiedPlace.openingHours = transformed.openingHours.value
      }
    }

    // Photos - just append, no priority handling
    if (transformed.photos && transformed.photos.length > 0) {
      unifiedPlace.photos.push(...transformed.photos)
    }

    // Ratings
    if (transformed.ratings) {
      // If we already have ratings, determine which to use based on source priority
      if (unifiedPlace.ratings) {
        if (transformed.ratings.rating) {
          unifiedPlace.ratings.rating =
            selectBestValue([
              unifiedPlace.ratings.rating,
              transformed.ratings.rating,
            ]) === transformed.ratings.rating.value
              ? transformed.ratings.rating
              : unifiedPlace.ratings.rating
        }

        if (transformed.ratings.reviewCount) {
          unifiedPlace.ratings.reviewCount =
            selectBestValue([
              unifiedPlace.ratings.reviewCount,
              transformed.ratings.reviewCount,
            ]) === transformed.ratings.reviewCount.value
              ? transformed.ratings.reviewCount
              : unifiedPlace.ratings.reviewCount
        }
      } else {
        // If no existing ratings, use the new ones
        unifiedPlace.ratings = transformed.ratings
      }
    }

    // Amenities
    if (
      transformed.amenities &&
      Object.keys(transformed.amenities).length > 0
    ) {
      Object.entries(transformed.amenities).forEach(([key, values]) => {
        const value = values[0]?.value
        if (value !== undefined) {
          if (!unifiedPlace.amenities[key] || adapter.sourceId === SOURCE.OSM) {
            unifiedPlace.amenities[key] = value
          }
        }
      })
    }

    // Add source reference with the correct timestamp
    unifiedPlace.sources.push({
      id: adapter.sourceId,
      name: adapter.sourceName,
      url: adapter.sourceUrl(data),
      updated:
        adapter.sourceId === SOURCE.OSM && data.timestamp
          ? data.timestamp
          : undefined,
      updatedBy:
        adapter.sourceId === SOURCE.OSM && 'user' in data
          ? data.user
          : undefined,
    })

    // Update lastUpdated timestamp only if this is from OSM or there is no lastUpdated yet
    if (adapter.sourceId === SOURCE.OSM || !unifiedPlace.lastUpdated) {
      unifiedPlace.lastUpdated = timestamp
    }
  } catch (error) {
    console.error(`Error merging data from ${adapter.sourceName}:`, error)
  }
}

function createBaseUnifiedPlace(
  place: Place,
  name: string,
  placeType: string,
): UnifiedPlace {
  return {
    id: `${place.type}/${place.id}`,
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
  type: 'node' | 'way' | 'relation',
  id: string,
): Promise<UnifiedPlace | null> => {
  try {
    console.log(`Fetching place details for ${type}/${id}`)
    const place = await fetchPlaceFromOverpass(type, id)

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
    const unifiedPlace = createBaseUnifiedPlace(place, name, placeType)

    mergePlaceData(unifiedPlace, osmAdapter, place)

    const externalData = await fetchExternalData(name, place.center, place)
    let currentIndex = 0

    if (API_CONFIG[SOURCE.GOOGLE]) {
      const googleData = externalData[currentIndex] as GooglePlaceDetails | null
      if (googleData) {
        mergePlaceData(unifiedPlace, googleAdapter, googleData)
      }
      currentIndex++
    }

    if (API_CONFIG[SOURCE.WIKIDATA]) {
      const [image, logo] = externalData[currentIndex] as [
        string | null,
        string | null,
      ]
      if (image) {
        unifiedPlace.photos.push({
          url: image,
          sourceId: SOURCE.WIKIDATA,
          isPrimary: true,
        })
      }
      if (logo) {
        unifiedPlace.photos.push({
          url: logo,
          sourceId: SOURCE.WIKIDATA,
          isLogo: true,
        })
      }
    }

    return unifiedPlace
  } catch (error) {
    console.error('Error getting place details:', error)
    return null
  }
}

// Calculate similarity score between two place names
function calculateNameSimilarity(name1: string, name2: string): number {
  if (!name1 || !name2) return 0

  const a = name1.toLowerCase().trim()
  const b = name2.toLowerCase().trim()

  // Exact match
  if (a === b) return 1

  // One is a substring of the other
  if (a.includes(b) || b.includes(a)) {
    return Math.min(a.length, b.length) / Math.max(a.length, b.length)
  }

  // Simple Levenshtein-inspired similarity
  let matchCount = 0
  const words1 = a.split(/\s+/)
  const words2 = b.split(/\s+/)

  for (const word1 of words1) {
    if (word1.length < 3) continue // Skip short words
    for (const word2 of words2) {
      if (word2.length < 3) continue
      if (word1 === word2 || word1.includes(word2) || word2.includes(word1)) {
        matchCount++
        break
      }
    }
  }

  return matchCount / Math.max(words1.length, words2.length)
}

// Calculate distance between two coordinates in meters
function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  // Simple Haversine formula implementation
  const R = 6371e3 // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lng2 - lng1) * Math.PI) / 180

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
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
  }
}

// Match and bucket search results from multiple sources
function matchPlaceCandidates(
  osmPlaces: Place[],
  googlePlaces: GooglePlaceDetails[],
  coordinates?: { lat: number; lng: number },
): PlaceCandidate[] {
  const candidates: PlaceCandidate[] = []

  // First create candidates from OSM places
  for (const osmPlace of osmPlaces) {
    const osmName = osmPlace.tags?.name || osmPlace.tags?.['brand:name'] || ''
    const osmLat = osmPlace.center?.lat || osmPlace.lat
    const osmLon = osmPlace.center?.lon || osmPlace.lon

    // Calculate distance if coordinates are provided
    let distance = Infinity
    if (coordinates && osmLat && osmLon) {
      distance = calculateDistance(
        coordinates.lat,
        coordinates.lng,
        osmLat,
        osmLon,
      )
    }

    const candidate: PlaceCandidate = {
      osmPlace,
      similarity: 1, // Full similarity for OSM places since they're our primary source
      distance,
    }

    // Try to find a matching Google place
    if (googlePlaces.length > 0 && osmName) {
      let bestMatch: { place: GooglePlaceDetails; similarity: number } | null =
        null

      for (const googlePlace of googlePlaces) {
        const nameSimilarity = calculateNameSimilarity(
          osmName,
          googlePlace.name,
        )

        // Check for geographic proximity
        let geoMatch = false
        if (osmLat && osmLon && googlePlace.geometry?.location) {
          const dist = calculateDistance(
            osmLat,
            osmLon,
            googlePlace.geometry.location.lat,
            googlePlace.geometry.location.lng,
          )
          // If places are within 100 meters, they're likely the same place
          if (dist < 100) {
            geoMatch = true
          }
        }

        // Combine name similarity and geographic proximity
        const overallSimilarity = geoMatch
          ? Math.max(0.7, nameSimilarity) // If close by, minimum 0.7 similarity
          : nameSimilarity

        if (
          overallSimilarity > 0.6 &&
          (!bestMatch || overallSimilarity > bestMatch.similarity)
        ) {
          bestMatch = {
            place: googlePlace,
            similarity: overallSimilarity,
          }
        }
      }

      if (bestMatch) {
        candidate.googlePlace = bestMatch.place
        // Remove this Google place so it's not matched again
        googlePlaces = googlePlaces.filter(
          (p) => p.place_id !== bestMatch!.place.place_id,
        )
      }
    }

    candidates.push(candidate)
  }

  // Add remaining Google places as candidates
  for (const googlePlace of googlePlaces) {
    let distance = Infinity
    if (coordinates && googlePlace.geometry?.location) {
      distance = calculateDistance(
        coordinates.lat,
        coordinates.lng,
        googlePlace.geometry.location.lat,
        googlePlace.geometry.location.lng,
      )
    }

    candidates.push({
      googlePlace,
      similarity: 0.5, // Lower base similarity since it's not from our primary source
      distance,
    })
  }

  return candidates.sort((a, b) => a.distance - b.distance)
}

// Updated function to handle place search
export const searchPlaces = async (
  query: string,
  coordinates?: { lat: number; lng: number },
  radius: number = 1000,
): Promise<PlaceSearchResult[]> => {
  try {
    console.log(`Searching for "${query}" with radius ${radius}m`)

    // Search OSM places using Nominatim as the primary search engine
    let osmPlaces: Place[] = []
    if (coordinates) {
      osmPlaces = await searchNominatim(
        query,
        coordinates.lat,
        coordinates.lng,
        radius,
      )
    } else {
      // Search globally if no coordinates provided
      osmPlaces = await searchNominatim(query)
    }

    // If Nominatim returns no results, try Overpass as a fallback
    if (osmPlaces.length === 0) {
      console.log('No results from Nominatim, trying Overpass...')
      if (coordinates) {
        osmPlaces = await searchOverpass(
          query,
          coordinates.lat,
          coordinates.lng,
          radius,
        )
      } else {
        osmPlaces = await searchOverpass(query)
      }
    }

    // Search Google places
    let googlePlaces: GooglePlaceDetails[] = []
    if (API_CONFIG[SOURCE.GOOGLE] && coordinates) {
      googlePlaces = await searchGooglePlaces(
        query,
        coordinates.lat,
        coordinates.lng,
        radius,
      )
    }

    console.log(
      `Found ${osmPlaces.length} OSM places and ${googlePlaces.length} Google places`,
    )

    // Match and bucket candidates
    const candidates = matchPlaceCandidates(
      osmPlaces,
      googlePlaces,
      coordinates,
    )

    // Process candidates into unified places
    const results: PlaceSearchResult[] = []

    for (const candidate of candidates) {
      if (candidate.osmPlace) {
        const osmPlace = candidate.osmPlace
        const name =
          osmPlace.tags?.name || osmPlace.tags?.['brand:name'] || query
        const placeType = getPlaceType(osmPlace.tags || {})

        // Create a base unified place
        const unifiedPlace = createBaseUnifiedPlace(osmPlace, name, placeType)

        // Merge OSM data
        mergePlaceData(unifiedPlace, osmAdapter, osmPlace)

        // Merge Google data if available
        if (candidate.googlePlace) {
          mergePlaceData(unifiedPlace, googleAdapter, candidate.googlePlace)
        }

        // Create search result
        const searchResult = createSearchResult(unifiedPlace)
        searchResult.distance = candidate.distance

        results.push(searchResult)
      } else if (candidate.googlePlace) {
        // Handle Google-only places
        const googlePlace = candidate.googlePlace

        const searchResult: PlaceSearchResult = {
          id: `google/${googlePlace.place_id}`,
          name: googlePlace.name,
          placeType: googlePlace.types[0] || 'unknown',
          geometry: {
            type: 'point',
            center: {
              lat: googlePlace.geometry?.location.lat || 0,
              lng: googlePlace.geometry?.location.lng || 0,
            },
          },
          address: {
            formatted: googlePlace.formatted_address,
          },
          description: googlePlace.editorial_summary?.overview,
          ratings: {
            rating: googlePlace.rating,
            reviewCount: googlePlace.user_ratings_total,
          },
          openingHours: googlePlace.opening_hours
            ? {
                isOpenNow: googlePlace.opening_hours.open_now || false,
                regularHours: googlePlace.opening_hours.periods?.map((p) => ({
                  day: p.open.day,
                  open: p.open.time,
                  close: p.close.time,
                })),
              }
            : undefined,
          distance: candidate.distance,
          sources: [
            {
              id: SOURCE.GOOGLE,
              name: 'Google Places',
              url: googlePlace.google_maps_uri,
            },
          ],
        }

        results.push(searchResult)
      }
    }

    // Limit to top 20 results
    return results.slice(0, 20)
  } catch (error) {
    console.error('Error searching for places:', error)
    return []
  }
}

// Function to get autocomplete suggestions for places
export const getPlaceAutocomplete = async (
  query: string,
  coordinates?: { lat: number; lng: number },
  radius: number = 10000,
): Promise<AutocompletePrediction[]> => {
  try {
    if (!query || query.length < 2) {
      return []
    }

    console.log(`Getting autocomplete suggestions for "${query}"`)

    // For now, use only Google Places autocomplete
    // Later, we'll integrate with Pelias as well
    const googleSuggestions = await getGooglePlacesAutocomplete(
      query,
      coordinates?.lat,
      coordinates?.lng,
      radius,
    )

    return googleSuggestions

    // Future implementation:
    // When Pelias is integrated, we can add code to:
    // 1. Search both Google Places and Pelias
    // 2. Merge and deduplicate results
    // 3. Sort by relevance
  } catch (error) {
    console.error('Error getting place autocomplete suggestions:', error)
    return []
  }
}
