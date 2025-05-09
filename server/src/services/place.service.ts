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
  searchGooglePlaces,
  getGooglePlacesAutocomplete,
  getPeliasAutocomplete,
  transformGooglePlace,
} from './external-api.service'
import { GOOGLE_PLACES_API_URL } from '../lib/constants'
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
import type { Bookmark } from '../types/library.types'
import { findBookmarkByExternalIds } from './library/bookmarks.service'
import type { AutocompletePrediction } from '../types/place.types'

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

// Calculate similarity score between two place names
function calculateNameSimilarity(name1: string, name2: string): number {
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

  // Get the target place's geographic center
  const targetCenter = [
    targetPlace.center?.lon || 0,
    targetPlace.center?.lat || 0,
  ]

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
    const MIN_NAME_SIMILARITY = 0.7 // Increased from 0.6 to 0.7 to prevent obviously different buildings from matching
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

    // Calculate geographic distance
    let distanceMeters = Infinity
    if (coordinates) {
      if ('center' in candidate && candidate.center) {
        // OSM place
        distanceMeters = calculateDistance(
          coordinates.lat,
          coordinates.lng,
          candidate.center.lat,
          candidate.center.lon,
        )
      } else if ('geometry' in candidate && candidate.geometry) {
        // Google place with location property
        const googleCandidate = candidate as GooglePlaceDetails
        if (
          googleCandidate.geometry &&
          'location' in googleCandidate.geometry
        ) {
          const location = googleCandidate.geometry.location
          distanceMeters = calculateDistance(
            coordinates.lat,
            coordinates.lng,
            location.lat,
            location.lng,
          )
        }
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

// Updated function to handle place search
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

    // Search OSM places using Nominatim as the primary search engine
    let osmPlaces: Place[] = []
    if (coordinates) {
      console.log(`Searching Nominatim near coordinates with radius ${radius}m`)
      osmPlaces = await searchNominatim(
        query,
        coordinates.lat,
        coordinates.lng,
        radius,
      )
    } else {
      // Search globally if no coordinates provided
      console.log(`Searching Nominatim globally`)
      osmPlaces = await searchNominatim(query)
    }

    // If Nominatim returns no results, try Overpass as a fallback
    if (osmPlaces.length === 0) {
      console.log('No results from Nominatim, trying Overpass as fallback')
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

    console.log(`Found ${osmPlaces.length} OSM places`)

    // Search Google places if enabled
    let googlePlaces: GooglePlaceDetails[] = []
    if (API_CONFIG[SOURCE.GOOGLE] && coordinates) {
      console.log(
        `Searching Google Places near coordinates with radius ${radius}m`,
      )
      googlePlaces = await searchGooglePlaces(
        query,
        coordinates.lat,
        coordinates.lng,
        radius,
      )
      console.log(`Found ${googlePlaces.length} Google places`)
    }

    // Match and bucket candidates
    console.log(`Matching places from different sources...`)
    const candidates = matchPlaceCandidates(
      osmPlaces[0],
      googlePlaces,
      coordinates,
    )
    console.log(
      `Generated ${candidates.length} place candidates after matching`,
    )

    // Process candidates into unified places
    console.log(`Converting candidates to unified places...`)
    const results: PlaceSearchResult[] = []
    const processedIds = new Set<string>() // Track processed IDs to avoid duplication

    for (const candidate of candidates) {
      // Create a unified place from either OSM or Google data
      let unifiedPlace: UnifiedPlace | null = null

      if (candidate.osmPlace) {
        const osmPlace = candidate.osmPlace
        const placeName =
          osmPlace.tags?.name || osmPlace.tags?.['brand:name'] || query
        const placeType = getPlaceType(osmPlace.tags || {})

        // Skip if we already processed an OSM place with this ID
        const osmId = `${osmPlace.type}/${osmPlace.id}`
        if (processedIds.has(osmId)) {
          console.log(`Skipping already processed OSM place: ${osmId}`)
          continue
        }
        processedIds.add(osmId)

        // Create base unified place
        console.log(`Creating unified place from OSM: ${placeName} (${osmId})`)
        unifiedPlace = createBaseUnifiedPlace(osmPlace, placeName, placeType)

        // Merge OSM data
        mergePlaceData(unifiedPlace, osmAdapter, osmPlace)

        // Merge Google data if available
        if (candidate.googlePlace) {
          console.log(`Merging Google data for: ${candidate.googlePlace.name}`)
          mergePlaceData(unifiedPlace, googleAdapter, candidate.googlePlace)

          // Track processed Google ID to avoid duplication
          processedIds.add(`google/${candidate.googlePlace.place_id}`)
        }
      } else if (candidate.googlePlace) {
        // Handle Google-only places
        const googlePlace = candidate.googlePlace

        // Skip if we already processed a Google place with this ID
        const googleId = `google/${googlePlace.place_id}`
        if (processedIds.has(googleId)) {
          console.log(`Skipping already processed Google place: ${googleId}`)
          continue
        }
        processedIds.add(googleId)

        console.log(
          `Creating unified place from Google only: ${googlePlace.name} (${googleId})`,
        )

        // Create a unified place directly from Google data
        unifiedPlace = {
          id: googleId,
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

        // Merge Google data into the unified place
        mergePlaceData(unifiedPlace, googleAdapter, googlePlace)
      }

      // Add the search result if we have a valid unified place
      if (unifiedPlace) {
        // Find associated bookmark for search results
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

        const searchResult = createSearchResult(unifiedPlace)
        searchResult.distance = candidate.distance
        results.push(searchResult)
      }
    }

    // Final result sorting with multiple factors
    const sortedResults = results.sort((a, b) => {
      // If both results have ratings, use them as a factor
      if (a.ratings?.rating && b.ratings?.rating) {
        const ratingDiff = b.ratings.rating - a.ratings.rating

        // If ratings are significantly different, prioritize better-rated places
        if (Math.abs(ratingDiff) >= 1.0) {
          return ratingDiff
        }
      }

      // If distances are significantly different, prioritize closer places
      const distanceDiff = (a.distance || Infinity) - (b.distance || Infinity)
      if (Math.abs(distanceDiff) > 300) {
        return distanceDiff
      }

      // If all else is similar, prioritize OSM places (our primary data source)
      const aIsOsm =
        a.id.startsWith('node/') ||
        a.id.startsWith('way/') ||
        a.id.startsWith('relation/')
      const bIsOsm =
        b.id.startsWith('node/') ||
        b.id.startsWith('way/') ||
        b.id.startsWith('relation/')

      if (aIsOsm && !bIsOsm) return -1
      if (!aIsOsm && bIsOsm) return 1

      // If both from same source, sort by distance
      return (a.distance || Infinity) - (b.distance || Infinity)
    })

    console.log(`Returning ${sortedResults.length} sorted search results`)

    // Limit to top 20 results
    return sortedResults.slice(0, 20)
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
): Promise<UnifiedPlace[]> => {
  try {
    if (!query || query.length < 2) {
      return []
    }

    console.log(`Getting autocomplete suggestions for "${query}"`)

    const promises: Promise<UnifiedPlace[]>[] = []

    promises.push(
      getPeliasAutocomplete(query, coordinates?.lat, coordinates?.lng, radius),
    )

    if (API_CONFIG[SOURCE.GOOGLE]) {
      promises.push(
        transformGoogleAutocomplete(
          getGooglePlacesAutocomplete(
            query,
            coordinates?.lat,
            coordinates?.lng,
            radius,
          ),
        ),
      )
    }

    // Wait for all queries to complete
    const results = await Promise.all(promises)

    console.log(`Found ${results.length} autocomplete results`)

    // Combine all results
    let allPlaces: UnifiedPlace[] = []
    results.forEach((providerPlaces) => {
      allPlaces = allPlaces.concat(providerPlaces)
    })

    // Deduplicate places between different providers
    const uniquePlaces = deduplicateAutocompletePlaces(allPlaces, coordinates)

    return uniquePlaces
  } catch (error) {
    console.error('Error getting place autocomplete suggestions:', error)
    return []
  }
}

// Helper function to transform Google autocomplete predictions to UnifiedPlace objects
async function transformGoogleAutocomplete(
  googlePromise: Promise<AutocompletePrediction[]>,
): Promise<UnifiedPlace[]> {
  try {
    const predictions = await googlePromise

    return predictions.map((prediction) => {
      // Ensure the Google place ID is properly formatted with google/ prefix
      // If it already has the prefix, keep it as is
      const googleId = prediction.placeId.startsWith('google/')
        ? prediction.placeId
        : `google/${prediction.placeId}`

      // Create a description that includes the name and address for better display
      const description =
        prediction.description ||
        `${prediction.mainText}, ${prediction.secondaryText}`

      // Extract coordinates from the prediction if available
      let lat = 0
      let lng = 0

      // Check various possible location properties on the prediction
      if (
        typeof prediction.lat === 'number' &&
        typeof prediction.lng === 'number'
      ) {
        // Direct lat/lng properties
        lat = prediction.lat
        lng = prediction.lng
      } else {
        // Try to access the location property safely
        // TypeScript doesn't know about location, but it might exist at runtime
        const anyPrediction = prediction as any
        if (
          anyPrediction.location &&
          typeof anyPrediction.location.latitude === 'number' &&
          typeof anyPrediction.location.longitude === 'number'
        ) {
          lat = anyPrediction.location.latitude
          lng = anyPrediction.location.longitude
        }
      }

      // Log coordinate extraction for debugging
      console.log(
        `Extracted coordinates for ${prediction.mainText}: (${lat}, ${lng})`,
      )

      const unifiedPlace: UnifiedPlace = {
        id: googleId,
        externalIds: {
          [SOURCE.GOOGLE]: prediction.placeId.replace('google/', ''),
        },
        name: prediction.mainText,
        description: description,
        placeType: prediction.types[0] || 'unknown',
        geometry: {
          type: 'point',
          center: {
            lat: lat,
            lng: lng,
          },
        },
        photos: [],
        address: prediction.secondaryText
          ? {
              formatted: prediction.secondaryText,
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
        sources: [
          {
            id: SOURCE.GOOGLE,
            name: 'Google',
            url: '',
          },
        ],
        lastUpdated: getTimestamp(),
        createdAt: getTimestamp(),
      }

      return unifiedPlace
    })
  } catch (error) {
    console.error('Error transforming Google autocomplete predictions:', error)
    return []
  }
}

/**
 * This function deduplicates autocomplete results across different providers.
 * It groups places by provider first, then by name, and finally by location.
 * It then selects the best result for each group.
 */
function deduplicateAutocompletePlaces(
  places: UnifiedPlace[],
  coordinates?: { lat: number; lng: number },
): UnifiedPlace[] {
  if (!places.length) return []

  console.log(
    `Deduplicating ${places.length} autocomplete places across providers`,
  )

  // Log place sources and coordinates for debugging
  places.forEach((place) => {
    console.log(
      `Place ${place.name} (${place.id}): source=${place.sources[0]?.id}, coordinates=(${place.geometry.center.lat}, ${place.geometry.center.lng})`,
    )
  })

  // Group places by provider first
  const placesByProvider: Record<string, UnifiedPlace[]> = {}

  places.forEach((place) => {
    const providerId = place.sources[0]?.id || 'unknown'
    if (!placesByProvider[providerId]) {
      placesByProvider[providerId] = []
    }
    placesByProvider[providerId].push(place)
  })

  // First priority: Add all OSM/Pelias results as base places
  const finalResults: UnifiedPlace[] = []
  const nameToPlaceMap: Record<
    string,
    { place: UnifiedPlace; nameKey: string }
  > = {}

  // Helper function to normalize name for comparison
  const normalizeName = (name: string): string => {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
  }

  // Helper function to normalize address for comparison
  const normalizeAddress = (address: string): string => {
    return address
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/,/g, '')
      .replace(/\bstreet\b/g, 'st')
      .replace(/\blane\b/g, 'ln')
      .replace(/\bavenue\b/g, 'ave')
      .replace(/\bboulevard\b/g, 'blvd')
      .replace(/\broad\b/g, 'rd')
      .replace(/\bunit\b/g, '')
      .replace(/\bsuite\b/g, '')
      .replace(/\bapt\b/g, '')
      .replace(/\bnorth\b/g, 'n')
      .replace(/\bsouth\b/g, 's')
      .replace(/\beast\b/g, 'e')
      .replace(/\bwest\b/g, 'w')
      .replace(/\b(nc|north carolina)\b/g, '')
      .replace(/\busa\b/g, '')
      .replace(/[^\w\s]/g, '') // Remove special characters
      .replace(/\d{5}(\-\d{4})?/g, '') // Remove zip codes
      .trim()
  }

  const getAddressString = (place: UnifiedPlace): string | null => {
    if (place.address?.formatted) {
      return place.address.formatted
    }
    if (place.address?.street1) {
      let addressStr = place.address.street1
      if (place.address.locality) addressStr += ' ' + place.address.locality
      return addressStr
    }
    if (place.description && place.description.includes(',')) {
      const parts = place.description.split(',')
      if (parts.length > 1) {
        return parts.slice(1).join(',').trim()
      }
    }
    return null
  }

  const getStreetNumber = (address: string): string | null => {
    const match = address.match(/^\d+/)
    return match ? match[0] : null
  }

  const osmPeliasResults = [
    ...(placesByProvider[SOURCE.OSM] || []),
    ...(placesByProvider[SOURCE.PELIAS] || []),
  ]

  osmPeliasResults.forEach((place) => {
    const nameKey = normalizeName(place.name)
    finalResults.push(place)
    nameToPlaceMap[place.id] = { place, nameKey }
  })

  Object.entries(placesByProvider).forEach(([providerId, providerPlaces]) => {
    if (providerId === SOURCE.OSM || providerId === SOURCE.PELIAS) return

    providerPlaces.forEach((place) => {
      const normalizedName = normalizeName(place.name)

      let matchFound = false

      for (const { place: existingPlace, nameKey } of Object.values(
        nameToPlaceMap,
      )) {
        // Skip if provider is the same (no need to merge within the same provider)
        if (existingPlace.sources[0]?.id === place.sources[0]?.id) continue

        if (nameKey === normalizedName) {
          const placeAddress = getAddressString(place)
          const existingAddress = getAddressString(existingPlace)

          console.log(
            `Comparing addresses for ${place.name}: "${placeAddress}" vs "${existingAddress}"`,
          )

          let isMatch = true

          if (placeAddress && existingAddress) {
            const placeStreetNum = getStreetNumber(placeAddress)
            const existingStreetNum = getStreetNumber(existingAddress)

            console.log(
              `Street numbers: ${placeStreetNum} vs ${existingStreetNum}`,
            )

            if (
              placeStreetNum &&
              existingStreetNum &&
              placeStreetNum !== existingStreetNum
            ) {
              console.log(
                `Different street numbers (${placeStreetNum} vs ${existingStreetNum}), not merging`,
              )
              isMatch = false
            } else {
              const normalizedPlaceAddr = normalizeAddress(placeAddress)
              const normalizedExistingAddr = normalizeAddress(existingAddress)

              console.log(
                `Normalized addresses: "${normalizedPlaceAddr}" vs "${normalizedExistingAddr}"`,
              )

              isMatch =
                !!normalizedPlaceAddr &&
                !!normalizedExistingAddr &&
                (normalizedPlaceAddr.includes(normalizedExistingAddr) ||
                  normalizedExistingAddr.includes(normalizedPlaceAddr) ||
                  // Check for matching street number if available
                  (!!placeStreetNum &&
                    !!existingStreetNum &&
                    placeStreetNum === existingStreetNum))

              console.log(`Address match result: ${isMatch}`)
            }
          }

          if (isMatch) {
            console.log(
              `Merging duplicate ${providerId} place: ${place.name} into existing place (address match)`,
            )

            // Preserve external IDs from both sources
            if (place.externalIds) {
              Object.entries(place.externalIds).forEach(
                ([idSource, idValue]) => {
                  existingPlace.externalIds[idSource] = idValue
                },
              )
            }

            // Find the appropriate adapter for this provider
            let adapter: PlaceDataAdapter
            if (providerId === SOURCE.GOOGLE) {
              adapter = googleAdapter
            } else {
              // Skip if we don't have an adapter for this provider
              console.log(
                `No adapter found for provider ${providerId}, skipping merge`,
              )
              continue
            }

            // Use existing merge logic to combine the places
            mergePlaceData(existingPlace, adapter, place)
            matchFound = true
            break
          } else {
            console.log(
              `Same name but different address, not merging: ${place.name}`,
            )
          }
        }

        // Check for close matches with coordinates if available
        if (
          !matchFound &&
          coordinates &&
          place.geometry.center.lat !== 0 &&
          place.geometry.center.lng !== 0 &&
          existingPlace.geometry.center.lat !== 0 &&
          existingPlace.geometry.center.lng !== 0
        ) {
          // Check name similarity
          const nameSimilarity = calculateNameSimilarity(
            existingPlace.name,
            place.name,
          )
          if (nameSimilarity > 0.85) {
            // If names are similar, check if locations are close
            const distance = calculateDistance(
              existingPlace.geometry.center.lat,
              existingPlace.geometry.center.lng,
              place.geometry.center.lat,
              place.geometry.center.lng,
            )

            console.log(
              `Distance between similar places ${place.name} and ${
                existingPlace.name
              }: ${distance.toFixed(0)}m`,
            )

            if (distance < 300) {
              // Places within 300m with similar names
              console.log(
                `Merging likely duplicate ${providerId} place: ${
                  place.name
                } based on name similarity (${nameSimilarity.toFixed(
                  2,
                )}) and location (${distance.toFixed(0)}m)`,
              )

              // Preserve external IDs from both sources
              if (place.externalIds) {
                Object.entries(place.externalIds).forEach(
                  ([idSource, idValue]) => {
                    existingPlace.externalIds[idSource] = idValue
                  },
                )
              }

              // Find the appropriate adapter
              let adapter: PlaceDataAdapter
              if (providerId === SOURCE.GOOGLE) {
                adapter = googleAdapter
              } else {
                console.log(
                  `No adapter found for provider ${providerId}, skipping merge`,
                )
                continue
              }

              // Merge the place data
              mergePlaceData(existingPlace, adapter, place)
              matchFound = true
              break
            }
          }
        }
      }

      // If no match was found, add as a new place
      if (!matchFound) {
        console.log(`No match found for ${place.name}, adding as new place`)
        finalResults.push(place)
        nameToPlaceMap[place.id] = { place, nameKey: normalizedName }
      }
    })
  })

  console.log(
    `Returned ${finalResults.length} deduplicated places (original: ${places.length})`,
  )
  return finalResults
}

// Generic function to get place details by any provider ID
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
