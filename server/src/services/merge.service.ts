import type { AttributedValue, SourceId } from '../types/place.types'
import { Source, SOURCE, SOURCE_PRIORITIES } from '../lib/constants'
import * as turf from '@turf/turf'
import type { Place } from '../types/place.types'
import { cloneDeep, groupBy } from 'lodash'
import * as fuzz from 'fuzzball'
import type { Feature, Point } from 'geojson'

/**
 * Gets the priority of a data source
 * Higher value = higher priority
 */
export function getSourcePriority(sourceId: string): number {
  return SOURCE_PRIORITIES[sourceId as keyof typeof SOURCE_PRIORITIES] || 0
}

/**
 * Normalize text for comparison (names, addresses, etc.)
 * Works globally for any language
 */
export function normalizeText(text: string): string {
  return (
    text
      .toLowerCase()
      .trim()
      // Remove common business suffixes (English)
      .replace(
        /\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company)\b/g,
        '',
      )
      // Remove punctuation but keep unicode letters and numbers
      .replace(/[^\w\s\u00C0-\u017F\u0100-\u024F\u1E00-\u1EFF]/g, ' ')
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      .trim()
  )
}

/**
 * Calculate similarity between two texts using fuzzy matching
 * Returns a score from 0 to 1, where 1 is a perfect match
 */
export function calculateTextSimilarity(text1: string, text2: string): number {
  if (!text1 || !text2) return 0

  const normalized1 = normalizeText(text1)
  const normalized2 = normalizeText(text2)

  // Use fuzzball's token_set_ratio for best results
  const similarity = fuzz.token_set_ratio(normalized1, normalized2)
  return similarity / 100 // Convert from 0-100 to 0-1 scale
}

/**
 * Extract numeric patterns from text (house numbers, postal codes, etc.)
 */
export function extractNumbers(text: string): string[] {
  return (text.match(/\b\d+[a-zA-Z]?\b/g) || []).map((num) => num.toLowerCase())
}

/**
 * Check if two addresses likely refer to the same location
 */
export function doAddressesMatch(place1: Place, place2: Place): boolean {
  const address1 = getAddressString(place1)
  const address2 = getAddressString(place2)

  if (!address1 || !address2) return false

  // If both have numbers and none match, likely different places
  const numbers1 = extractNumbers(address1)
  const numbers2 = extractNumbers(address2)

  if (numbers1.length > 0 && numbers2.length > 0) {
    const hasCommonNumber = numbers1.some((num1) => numbers2.includes(num1))
    if (!hasCommonNumber) return false
  }

  // Use fuzzy matching for address comparison
  const similarity = calculateTextSimilarity(address1, address2)
  return similarity >= 0.8 // 80% similarity threshold
}

export function getAddressString(place: Place): string | null {
  if (place.address?.value.formatted) {
    return place.address.value.formatted
  }
  if (place.address?.value.street1) {
    let addressStr = place.address.value.street1
    if (place.address.value.locality) {
      addressStr += ' ' + place.address.value.locality
    }
    return addressStr
  }
  return null
}

export function createTurfPoint(place: Place): Feature<Point> | null {
  const { lat, lng } = place.geometry.value.center || {}
  if (!lat || !lng || (lat === 0 && lng === 0)) return null
  return turf.point([lng, lat])
}

export function arePointsClose(
  point1: Feature<Point> | null,
  point2: Feature<Point> | null,
  maxDistanceMeters: number = 100,
): boolean {
  if (!point1 || !point2) return false
  const distanceMeters = turf.distance(point1, point2) * 1000
  return distanceMeters < maxDistanceMeters
}

/**
 * Smart address merging that prioritizes quality over source priority
 */
function mergeAddressValue(
  target: AttributedValue<any> | null,
  source: AttributedValue<any> | null,
): AttributedValue<any> | null {
  if (!source) return target
  if (!target) return cloneDeep(source)

  // Helper to check if address has street-level data (house numbers)
  const hasStreetData = (address: any): boolean => {
    if (!address?.value) return false

    // OSM format: street1 contains house number + street name
    if (address.value.street1) {
      return extractNumbers(address.value.street1).length > 0
    }

    // Formatted address with numbers
    if (address.value.formatted) {
      return extractNumbers(address.value.formatted).length > 0
    }

    return false
  }

  const targetHasStreetData = hasStreetData(target)
  const sourceHasStreetData = hasStreetData(source)

  // If target has street data and source doesn't, keep target
  if (targetHasStreetData && !sourceHasStreetData) {
    return target
  }

  // If source has street data and target doesn't, use source
  if (sourceHasStreetData && !targetHasStreetData) {
    return cloneDeep(source)
  }

  // If both have street data, use source priority
  const targetPriority = getSourcePriority(target.sourceId)
  const sourcePriority = getSourcePriority(source.sourceId)

  return sourcePriority > targetPriority ? cloneDeep(source) : target
}

/**
 * Generic function to merge AttributedValue instances based on source priority
 */
function mergeAttributedValue<T>(
  target: AttributedValue<T> | null,
  source: AttributedValue<T> | null,
): AttributedValue<T> | null {
  if (!source) return target
  if (!target) return cloneDeep(source)

  const targetPriority = getSourcePriority(target.sourceId)
  const sourcePriority = getSourcePriority(source.sourceId)

  return sourcePriority > targetPriority ? cloneDeep(source) : target
}

/**
 * Merges records of attributed values
 */
function mergeAttributedRecord<T>(
  target: Record<string, AttributedValue<T>> | null,
  source: Record<string, AttributedValue<T>> | null,
): Record<string, AttributedValue<T>> {
  if (!source) return target || {}
  if (!target) return cloneDeep(source)

  const result = { ...target }

  for (const [key, sourceValue] of Object.entries(source)) {
    if (!result[key]) {
      result[key] = cloneDeep(sourceValue)
      continue
    }

    result[key] = mergeAttributedValue(result[key], sourceValue) || result[key]
  }

  return result
}

/**
 * Determines if two places should be merged based on name similarity and location
 */
function shouldMergePlaces(place1: Place, place2: Place): boolean {
  const nameSimilarity = calculateTextSimilarity(
    place1.name.value,
    place2.name.value,
  )
  const point1 = createTurfPoint(place1)
  const point2 = createTurfPoint(place2)

  // High name similarity + close proximity
  if (nameSimilarity > 0.85 && arePointsClose(point1, point2, 150)) return true

  // Very close places with decent name similarity
  if (nameSimilarity > 0.8 && arePointsClose(point1, point2, 50)) return true

  // Extremely close places with basic name similarity
  if (nameSimilarity > 0.7 && arePointsClose(point1, point2, 10)) return true

  // Address-based matching for same names
  if (nameSimilarity > 0.7 && doAddressesMatch(place1, place2)) return true

  return false
}

/**
 * Merges multiple Place objects into one, prioritizing data based on source priorities
 */
export function mergePlaces(
  primaryPlace: Place,
  ...additionalPlaces: (Place | null)[]
): Place {
  const validPlaces = additionalPlaces.filter((p): p is Place => p !== null)
  if (validPlaces.length === 0) return cloneDeep(primaryPlace)

  const result = cloneDeep(primaryPlace)

  for (const place of validPlaces) {
    // Merge external IDs
    Object.assign(result.externalIds, place.externalIds)

    // Merge attributed values
    result.name = mergeAttributedValue(result.name, place.name) || result.name
    result.description = mergeAttributedValue(
      result.description,
      place.description,
    )
    result.placeType =
      mergeAttributedValue(result.placeType, place.placeType) ||
      result.placeType
    result.geometry =
      mergeAttributedValue(result.geometry, place.geometry) || result.geometry

    // Merge address with special logic
    if (place.address) {
      result.address = mergeAddressValue(result.address, place.address)
    }

    // Merge contact info
    if (place.contactInfo.phone) {
      result.contactInfo.phone = mergeAttributedValue(
        result.contactInfo.phone,
        place.contactInfo.phone,
      )
    }
    if (place.contactInfo.email) {
      result.contactInfo.email = mergeAttributedValue(
        result.contactInfo.email,
        place.contactInfo.email,
      )
    }
    if (place.contactInfo.website) {
      result.contactInfo.website = mergeAttributedValue(
        result.contactInfo.website,
        place.contactInfo.website,
      )
    }
    result.contactInfo.socials = mergeAttributedRecord(
      result.contactInfo.socials,
      place.contactInfo.socials,
    )

    // Merge other fields
    result.openingHours = mergeAttributedValue(
      result.openingHours,
      place.openingHours,
    )
    result.amenities = mergeAttributedRecord(result.amenities, place.amenities)

    // Merge ratings
    if (place.ratings) {
      if (!result.ratings) {
        result.ratings = cloneDeep(place.ratings)
      } else {
        if (place.ratings.rating) {
          result.ratings.rating =
            mergeAttributedValue(result.ratings.rating, place.ratings.rating) ||
            result.ratings.rating
        }
        if (place.ratings.reviewCount) {
          result.ratings.reviewCount =
            mergeAttributedValue(
              result.ratings.reviewCount,
              place.ratings.reviewCount,
            ) || result.ratings.reviewCount
        }
      }
    }

    // Merge photos without duplicates
    if (place.photos.length > 0) {
      const existingUrls = new Set(
        result.photos.map((photo) => photo.value.url),
      )
      for (const photo of place.photos) {
        if (!existingUrls.has(photo.value.url)) {
          result.photos.push(cloneDeep(photo))
        }
      }
    }

    // Merge sources
    const existingSourceIds = new Set(result.sources.map((src) => src.id))
    for (const source of place.sources) {
      if (!existingSourceIds.has(source.id)) {
        result.sources.push(cloneDeep(source))
      }
    }
  }

  return result
}

/**
 * Merges and deduplicates places from multiple sources
 */
export function mergePlacesCollection(places: Place[]): Place[] {
  if (places.length <= 1) return places

  const groups: Place[][] = []

  for (const place of places) {
    let merged = false

    for (const group of groups) {
      if (shouldMergePlaces(place, group[0])) {
        group.push(place)
        merged = true
        break
      }
    }

    if (!merged) {
      groups.push([place])
    }
  }

  return groups.map((group) => {
    if (group.length === 1) return group[0]

    // Sort by source priority (highest first)
    const sortedGroup = group.sort((a, b) => {
      const aPriority = getSourcePriority(a.sources[0]?.id || '')
      const bPriority = getSourcePriority(b.sources[0]?.id || '')
      return bPriority - aPriority
    })

    const [primary, ...additional] = sortedGroup
    return mergePlaces(primary, ...additional)
  })
}
