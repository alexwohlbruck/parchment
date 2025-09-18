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
 * Extract Commons filename from various URL formats
 * Returns normalized filename (with underscores) or null if not a Commons URL
 */
export function extractCommonsFilename(url: string): string | null {
  try {
    let filename: string | null = null

    // Commons direct upload URL: https://upload.wikimedia.org/wikipedia/commons/e/ec/EastWest_Blvd.jpg
    const uploadMatch = url.match(/\/wikipedia\/commons\/[^\/]+\/[^\/]+\/([^?]+)/)
    if (uploadMatch) {
      filename = decodeURIComponent(uploadMatch[1])
    }

    // Commons FilePath URL: https://commons.wikimedia.org/wiki/Special:FilePath/EastWest%20Blvd.jpg
    if (!filename) {
      const filePathMatch = url.match(/\/Special:FilePath\/([^?]+)/)
      if (filePathMatch) {
        filename = decodeURIComponent(filePathMatch[1]).replace(/%20/g, ' ')
      }
    }

    // Commons File page URL: https://commons.wikimedia.org/wiki/File:EastWest_Blvd.jpg
    if (!filename) {
      const filePageMatch = url.match(/\/wiki\/File:([^?]+)/)
      if (filePageMatch) {
        filename = decodeURIComponent(filePageMatch[1]).replace(/%20/g, ' ')
      }
    }

    // Normalize spaces to underscores for consistent comparison
    return filename ? filename.replace(/ /g, '_') : null
  } catch (error) {
    return null
  }
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
 * Improved address similarity that handles structured data, formatted addresses, and missing data
 * Returns 0 if either place has no address data (as requested)
 * Focuses on street name and number only - simple and fast
 */
export function calculateAddressSimilarity(
  place1: Place,
  place2: Place,
): number {
  const address1 = place1.address?.value
  const address2 = place2.address?.value

  // Return 0% match if either place has no address data
  if (!address1 || !address2) return 0

  // Get street strings from both addresses
  const street1 = getStreetString(address1)
  const street2 = getStreetString(address2)

  // If we can't extract street info from either, return 0
  if (!street1 || !street2) return 0

  // Extract and compare house numbers first
  const numbers1 = extractNumbers(street1)
  const numbers2 = extractNumbers(street2)

  // If both have house numbers but they don't match, different places
  if (numbers1.length > 0 && numbers2.length > 0) {
    const hasCommonNumber = numbers1.some((num1) => numbers2.includes(num1))
    if (!hasCommonNumber) return 0
  }

  // Compare normalized street names
  const normalized1 = normalizeStreetName(street1)
  const normalized2 = normalizeStreetName(street2)

  return calculateTextSimilarity(normalized1, normalized2)
}

/**
 * Extract street information from any address format
 */
function getStreetString(address: any): string | null {
  // Structured address - use street1 directly
  if (address.street1) {
    return address.street1
  }

  // Formatted address - extract the first part (usually the street)
  if (address.formatted) {
    const parts = address.formatted.split(',').map((p: string) => p.trim())
    return parts[0] || null
  }

  return null
}

/**
 * Normalize street names by handling common abbreviations
 */
function normalizeStreetName(street: string): string {
  return (
    normalizeText(street)
      // Normalize directional abbreviations
      .replace(/\b(n|north)\b/g, 'north')
      .replace(/\b(s|south)\b/g, 'south')
      .replace(/\b(e|east)\b/g, 'east')
      .replace(/\b(w|west)\b/g, 'west')
      .replace(/\b(ne|northeast)\b/g, 'northeast')
      .replace(/\b(nw|northwest)\b/g, 'northwest')
      .replace(/\b(se|southeast)\b/g, 'southeast')
      .replace(/\b(sw|southwest)\b/g, 'southwest')
      // Normalize street type abbreviations
      .replace(/\b(st|street)\b/g, 'street')
      .replace(/\b(ave|avenue)\b/g, 'avenue')
      .replace(/\b(rd|road)\b/g, 'road')
      .replace(/\b(dr|drive)\b/g, 'drive')
      .replace(/\b(ln|lane)\b/g, 'lane')
      .replace(/\b(ct|court)\b/g, 'court')
      .replace(/\b(pl|place)\b/g, 'place')
      .replace(/\b(blvd|boulevard)\b/g, 'boulevard')
      // Remove unit/apartment info for comparison
      .replace(/\b(unit|apt|apartment|suite|ste)\s+\w+/g, '')
      .trim()
  )
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

export function createTurfPoint(place: Place): Feature<Point> {
  const { lat, lng } = place.geometry.value.center
  return turf.point([lng, lat])
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
 * Determines if two places should be merged based on name, address, and distance similarity
 */
function shouldMergePlaces(place1: Place, place2: Place): boolean {
  const point1 = createTurfPoint(place1)
  const point2 = createTurfPoint(place2)
  const distanceMeters = turf.distance(point1, point2, { units: 'meters' })

  // Hard distance cutoff - never merge places more than 500m apart
  if (distanceMeters > 500) return false

  // Distance weight using inverse square function
  const distanceSimilarity = 1 / (1 + Math.pow(distanceMeters / 100, 2))

  const nameSimilarity = calculateTextSimilarity(
    place1.name.value || '',
    place2.name.value || '',
  )
  const addressSimilarity = calculateAddressSimilarity(place1, place2)

  // Distance-based name similarity threshold
  // At 0m: 30%, at 100m: 65%, at 500m: 95%
  const requiredNameSimilarity = 0.3 + 0.65 * (1 - distanceSimilarity)

  // Early rejection if name similarity is too low
  if (nameSimilarity < requiredNameSimilarity) return false

  // For very close places with addresses, require address match
  if (
    distanceSimilarity > 0.5 &&
    addressSimilarity > 0 && // Has address data
    addressSimilarity < 0.7
  ) {
    return false
  }

  // Calculate weighted merge score
  let mergeScore: number

  if (addressSimilarity > 0) {
    // With addresses: name 50%, distance 25%, address 25%
    mergeScore =
      nameSimilarity * 0.5 +
      distanceSimilarity * 0.25 +
      addressSimilarity * 0.25
  } else {
    // Without addresses: name 70%, distance 30%
    mergeScore = nameSimilarity * 0.7 + distanceSimilarity * 0.3
  }

  // Distance-based merge score threshold
  // At 0m: 40%, at 100m: 67.5%, at 500m: 95%
  const requiredMergeScore = 0.4 + 0.55 * (1 - distanceSimilarity)

  return mergeScore >= requiredMergeScore
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

    // Merge photos without duplicates (including Commons filename deduplication)
    if (place.photos.length > 0) {
      const existingUrls = new Set(
        result.photos.map((photo) => photo.value.url),
      )
      const existingCommonsFiles = new Set(
        result.photos
          .map((photo) => extractCommonsFilename(photo.value.url))
          .filter((filename): filename is string => filename !== null)
      )
      
      for (const photo of place.photos) {
        const photoUrl = photo.value.url
        const commonsFilename = extractCommonsFilename(photoUrl)
        
        // Skip if we already have this exact URL
        if (existingUrls.has(photoUrl)) {
          continue
        }
        
        // Skip if we already have this Commons file (but keep the higher priority source)
        if (commonsFilename && existingCommonsFiles.has(commonsFilename)) {
          // Find the existing photo with this Commons file
          const existingPhotoIndex = result.photos.findIndex(existingPhoto => 
            extractCommonsFilename(existingPhoto.value.url) === commonsFilename
          )
          
          if (existingPhotoIndex !== -1) {
            const existingPhoto = result.photos[existingPhotoIndex]
            const newSourcePriority = getSourcePriority(photo.sourceId)
            const existingSourcePriority = getSourcePriority(existingPhoto.sourceId)
            
            // Replace with higher priority source
            if (newSourcePriority > existingSourcePriority) {
              result.photos[existingPhotoIndex] = cloneDeep(photo)
            }
          }
          continue
        }
        
        // Add new photo if it's not a duplicate
        result.photos.push(cloneDeep(photo))
        if (commonsFilename) {
          existingCommonsFiles.add(commonsFilename)
        }
        existingUrls.add(photoUrl)
      }
    }

    // Ensure only one photo is marked as primary (highest priority source wins)
    if (result.photos.length > 0) {
      // Find the photo with the highest source priority
      let primaryPhotoIndex = 0
      let highestPriority = getSourcePriority(result.photos[0].sourceId)
      
      for (let i = 1; i < result.photos.length; i++) {
        const priority = getSourcePriority(result.photos[i].sourceId)
        if (priority > highestPriority) {
          highestPriority = priority
          primaryPhotoIndex = i
        }
      }
      
      // Set primary status
      result.photos.forEach((photo, index) => {
        photo.value.isPrimary = index === primaryPhotoIndex
      })
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

// TODO: This can be optimized to never merge places from the same source
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
