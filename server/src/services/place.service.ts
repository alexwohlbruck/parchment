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
  transformGooglePlace,
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
import axios from 'axios'

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

    // Name - create attributed values and use selectBestValue to properly respect source priorities
    if (transformed.name) {
      const existingName = unifiedPlace.name
        ? {
            value: unifiedPlace.name,
            sourceId:
              unifiedPlace.sources.length > 0
                ? unifiedPlace.sources[0].id
                : 'unknown',
            timestamp,
          }
        : null

      // Only compare if we have an existing name
      if (existingName) {
        const selectedName = selectBestValue([existingName, transformed.name])
        unifiedPlace.name = selectedName || unifiedPlace.name || ''
        console.log(
          `Name selection: existingName=${existingName.value} (${existingName.sourceId}), newName=${transformed.name.value} (${transformed.name.sourceId}), selected=${selectedName}`,
        )
      } else {
        unifiedPlace.name = transformed.name.value
      }
    }

    // Description - respect source priorities
    if (transformed.description) {
      const existingDescription = unifiedPlace.description
        ? {
            value: unifiedPlace.description,
            sourceId:
              unifiedPlace.sources.length > 0
                ? unifiedPlace.sources[0].id
                : 'unknown',
            timestamp,
          }
        : null

      if (existingDescription) {
        const selectedDescription = selectBestValue([
          existingDescription,
          transformed.description,
        ])
        unifiedPlace.description =
          selectedDescription || unifiedPlace.description || ''
      } else {
        unifiedPlace.description = transformed.description.value
      }
    }

    // Address - respect source priorities
    if (transformed.address) {
      const existingAddress = unifiedPlace.address?.formatted
        ? {
            value: unifiedPlace.address,
            sourceId:
              unifiedPlace.sources.length > 0
                ? unifiedPlace.sources[0].id
                : 'unknown',
            timestamp,
          }
        : null

      if (existingAddress) {
        const selectedAddress = selectBestValue([
          existingAddress,
          transformed.address,
        ])
        unifiedPlace.address = selectedAddress || unifiedPlace.address || null
      } else {
        unifiedPlace.address = transformed.address.value
      }
    }

    // Contact Info - respect source priorities for each field
    if (transformed.contactInfo) {
      const { phone, email, website, socials } = transformed.contactInfo

      // Handle phone number with source priority
      if (phone) {
        const existingPhone = unifiedPlace.contactInfo.phone
          ? { ...unifiedPlace.contactInfo.phone }
          : null

        if (existingPhone) {
          unifiedPlace.contactInfo.phone =
            selectBestValue([existingPhone, phone]) === phone.value
              ? phone
              : existingPhone
        } else {
          unifiedPlace.contactInfo.phone = phone
        }
      }

      // Handle email with source priority
      if (email) {
        const existingEmail = unifiedPlace.contactInfo.email
          ? { ...unifiedPlace.contactInfo.email }
          : null

        if (existingEmail) {
          unifiedPlace.contactInfo.email =
            selectBestValue([existingEmail, email]) === email.value
              ? email
              : existingEmail
        } else {
          unifiedPlace.contactInfo.email = email
        }
      }

      // Handle website with source priority
      if (website) {
        const existingWebsite = unifiedPlace.contactInfo.website
          ? { ...unifiedPlace.contactInfo.website }
          : null

        if (existingWebsite) {
          unifiedPlace.contactInfo.website =
            selectBestValue([existingWebsite, website]) === website.value
              ? website
              : existingWebsite
        } else {
          unifiedPlace.contactInfo.website = website
        }
      }

      // Handle social media links with source priority
      if (socials && Object.keys(socials).length > 0) {
        // Merge social media links
        Object.entries(socials).forEach(([platform, value]) => {
          const existingSocial = unifiedPlace.contactInfo.socials[platform]
            ? { ...unifiedPlace.contactInfo.socials[platform] }
            : null

          if (existingSocial) {
            unifiedPlace.contactInfo.socials[platform] =
              selectBestValue([existingSocial, value]) === value.value
                ? value
                : existingSocial
          } else {
            unifiedPlace.contactInfo.socials[platform] = value
          }
        })
      }
    }

    // Opening Hours - respect source priorities
    if (transformed.openingHours) {
      const existingHours = unifiedPlace.openingHours
        ? {
            value: unifiedPlace.openingHours,
            sourceId:
              unifiedPlace.sources.length > 0
                ? unifiedPlace.sources[0].id
                : 'unknown',
            timestamp,
          }
        : null

      if (existingHours) {
        const selectedHours = selectBestValue([
          existingHours,
          transformed.openingHours,
        ])
        unifiedPlace.openingHours =
          selectedHours || unifiedPlace.openingHours || null
      } else {
        unifiedPlace.openingHours = transformed.openingHours.value
      }
    }

    // Photos - just append, no priority handling
    if (transformed.photos && transformed.photos.length > 0) {
      unifiedPlace.photos.push(...transformed.photos)
    }

    // Ratings - respect source priorities
    if (transformed.ratings) {
      if (unifiedPlace.ratings) {
        // Handle rating score
        if (transformed.ratings.rating) {
          const existingRating = unifiedPlace.ratings.rating
            ? { ...unifiedPlace.ratings.rating }
            : null

          if (existingRating) {
            unifiedPlace.ratings.rating =
              selectBestValue([existingRating, transformed.ratings.rating]) ===
              transformed.ratings.rating.value
                ? transformed.ratings.rating
                : existingRating
          } else {
            unifiedPlace.ratings.rating = transformed.ratings.rating
          }
        }

        // Handle review count
        if (transformed.ratings.reviewCount) {
          const existingReviewCount = unifiedPlace.ratings.reviewCount
            ? { ...unifiedPlace.ratings.reviewCount }
            : null

          if (existingReviewCount) {
            unifiedPlace.ratings.reviewCount =
              selectBestValue([
                existingReviewCount,
                transformed.ratings.reviewCount,
              ]) === transformed.ratings.reviewCount.value
                ? transformed.ratings.reviewCount
                : existingReviewCount
          } else {
            unifiedPlace.ratings.reviewCount = transformed.ratings.reviewCount
          }
        }
      } else {
        // If no existing ratings, use the new ones
        unifiedPlace.ratings = transformed.ratings
      }
    }

    // Amenities - respect source priorities
    if (
      transformed.amenities &&
      Object.keys(transformed.amenities).length > 0
    ) {
      Object.entries(transformed.amenities).forEach(([key, values]) => {
        if (!values || !values.length) return

        const value = values[0]
        if (!value || value.value === undefined) return

        const existingAmenity =
          unifiedPlace.amenities[key] !== undefined
            ? {
                value: unifiedPlace.amenities[key],
                sourceId:
                  unifiedPlace.sources.length > 0
                    ? unifiedPlace.sources[0].id
                    : 'unknown',
                timestamp,
              }
            : null

        if (existingAmenity) {
          const selectedValue = selectBestValue([existingAmenity, value])
          if (selectedValue !== null) {
            unifiedPlace.amenities[key] = selectedValue
          }
        } else if (value.value !== undefined) {
          unifiedPlace.amenities[key] = value.value
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

// Generic function to get place details by any provider ID
export const getPlaceDetailsByProviderId = async (
  provider: string,
  id: string,
): Promise<UnifiedPlace | null> => {
  try {
    console.log(
      `Getting place details by provider ID - Provider: "${provider}", ID: "${id}"`,
    )

    // Factory pattern - dispatch to the appropriate handler based on provider
    switch (provider) {
      case SOURCE.GOOGLE:
        return getPlaceDetailsByGoogleId(id)
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

// Google ID-specific implementation
async function getPlaceDetailsByGoogleId(
  googleId: string,
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

    return unifiedPlace
  } catch (error) {
    console.error('Error getting place details by Google ID:', error)
    return null
  }
}

export const getPlaceDetailsByNameAndLocation = async (
  name: string,
  coordinates: { lat: number; lng: number },
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
      osmPlaces,
      googlePlaces,
      coordinates,
    )

    if (candidates.length === 0) {
      return null
    }

    const bestCandidate = candidates[0]
    console.log(
      `Best candidate: OSM=${!!bestCandidate.osmPlace}, Google=${!!bestCandidate.googlePlace}, similarity=${
        bestCandidate.similarity
      }`,
    )

    let unifiedPlace: UnifiedPlace

    // Prioritize OSM data - if we have an OSM place, start with that
    if (bestCandidate.osmPlace) {
      const osmPlace = bestCandidate.osmPlace
      const placeName =
        osmPlace.tags?.name || osmPlace.tags?.['brand:name'] || name
      const placeType = getPlaceType(osmPlace.tags || {})

      console.log(`Creating base unified place from OSM: ${placeName}`)
      unifiedPlace = createBaseUnifiedPlace(osmPlace, placeName, placeType)

      // First add OSM data
      mergePlaceData(unifiedPlace, osmAdapter, osmPlace)

      // Then add Google data (OSM fields will be preserved due to priority)
      if (bestCandidate.googlePlace) {
        console.log(
          `Merging Google place data: ${bestCandidate.googlePlace.name}`,
        )
        mergePlaceData(unifiedPlace, googleAdapter, bestCandidate.googlePlace)
      }
    }
    // If no OSM data, fall back to Google
    else if (bestCandidate.googlePlace) {
      const googlePlace = bestCandidate.googlePlace
      console.log(`Creating place from Google data only: ${googlePlace.name}`)

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

    return unifiedPlace
  } catch (error) {
    console.error('Error getting place details by name and location:', error)
    return null
  }
}

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
  } catch (error) {
    console.error('Error fetching Google place by ID:', error)
    if (axios.isAxiosError(error) && error.response) {
      console.error('Error response status:', error.response.status)
      console.error('Error response data:', error.response.data)
    }
    return null
  }
}
