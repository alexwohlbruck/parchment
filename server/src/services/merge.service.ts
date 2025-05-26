import type { AttributedValue, SourceId } from '../types/place.types'
import { Source, SOURCE, SOURCE_PRIORITIES } from '../lib/constants'
import * as turf from '@turf/turf'
import type { Place } from '../types/place.types'
import { Feature, Point } from 'geojson'
import { cloneDeep, groupBy } from 'lodash'
import * as fuzz from 'fuzzball'

// TODO: Remove
type TurfPoint = Feature<Point>

/**
 * Calculate the similarity between two place names using fuzzy string matching
 * Returns a score from 0 to 1, where 1 is a perfect match
 */
function calculateNameSimilarity(name1: string, name2: string): number {
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

/**
 * Gets the priority of a data source
 * Higher value = higher priority
 */
export function getSourcePriority(sourceId: string): number {
  return SOURCE_PRIORITIES[sourceId as keyof typeof SOURCE_PRIORITIES] || 0
}

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
}

/**
 * Normalize an address for comparison in a language-agnostic way
 * This works for addresses worldwide, not just English/US addresses
 */
export function normalizeAddress(address: string): string {
  return (
    address
      .toLowerCase()
      .trim()
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      // Remove common punctuation but keep numbers and letters
      .replace(/[^\w\s\u00C0-\u017F\u0100-\u024F\u1E00-\u1EFF]/g, ' ')
      // Remove extra spaces created by punctuation removal
      .replace(/\s+/g, ' ')
      .trim()
  )
}

/**
 * Extract numeric patterns from an address (house numbers, postal codes, etc.)
 * This works for any address format globally
 */
export function extractAddressNumbers(address: string): string[] {
  // Match various numeric patterns that could be house numbers, postal codes, etc.
  const numberPatterns = address.match(/\b\d+[a-zA-Z]?\b/g) || []
  return numberPatterns.map((num) => num.toLowerCase())
}

/**
 * Check if two addresses likely refer to the same location
 * Uses fuzzy string matching and numeric pattern comparison
 * Language-agnostic approach that works globally
 */
export function doAddressesMatch(place1: Place, place2: Place): boolean {
  const address1 = getAddressString(place1)
  const address2 = getAddressString(place2)

  if (!address1 || !address2) return false

  // Extract numeric patterns (house numbers, postal codes, etc.)
  const numbers1 = extractAddressNumbers(address1)
  const numbers2 = extractAddressNumbers(address2)

  // If both have numbers and none match, likely different places
  if (numbers1.length > 0 && numbers2.length > 0) {
    const hasCommonNumber = numbers1.some((num1) =>
      numbers2.some((num2) => num1 === num2),
    )
    if (!hasCommonNumber) {
      return false
    }
  }

  // Normalize addresses for fuzzy comparison
  const normalized1 = normalizeAddress(address1)
  const normalized2 = normalizeAddress(address2)

  // Use fuzzy string matching for address comparison
  const similarity = fuzz.token_set_ratio(normalized1, normalized2)

  // Consider addresses matching if they have high similarity (80%+)
  // or if one is contained in the other (for cases like "123 Main St" vs "123 Main Street, City")
  return (
    similarity >= 80 ||
    normalized1.includes(normalized2) ||
    normalized2.includes(normalized1)
  )
}

export function getAddressString(place: Place): string | null {
  if (place.address?.value.formatted) {
    return place.address.value.formatted
  }
  if (place.address?.value.street1) {
    let addressStr = place.address.value.street1
    if (place.address.value.locality)
      addressStr += ' ' + place.address.value.locality
    return addressStr
  }
  if (place.description?.value && place.description.value.includes(',')) {
    const parts = place.description.value.split(',')
    if (parts.length > 1) {
      return parts.slice(1).join(',').trim()
    }
  }
  return null
}

export function getStreetNumber(address: string): string | null {
  // Extract the first number that could be a house/building number
  // This works for various global formats like "123", "123A", "123-125", etc.
  const numbers = extractAddressNumbers(address)
  return numbers.length > 0 ? numbers[0] : null
}

export function createTurfPoint(place: Place): TurfPoint | undefined {
  if (
    place.geometry.value.center &&
    place.geometry.value.center.lat !== 0 &&
    place.geometry.value.center.lng !== 0
  ) {
    return turf.point([
      place.geometry.value.center.lng,
      place.geometry.value.center.lat,
    ])
  }
  return undefined
}

export function arePointsClose(
  point1: TurfPoint | undefined,
  point2: TurfPoint | undefined,
  maxDistanceMeters: number = 100,
): boolean {
  if (!point1 || !point2) {
    return false
  }

  const distanceMeters = turf.distance(point1, point2) * 1000
  return distanceMeters < maxDistanceMeters
}

// TODO: Review this function and simplify
/**
 * Looks for duplicate places from results across providers and merges them
 */
export function deduplicatePlacesResults(places: Place[]): Place[] {
  if (!places.length) return []

  const placesBySource = groupBy(places, (place) => place.sources[0]!.id)

  // If we only have one data source, no work is needed
  if (Object.keys(placesBySource).length === 1) {
    return places
  }

  // First priority: Add all OSM/OpenAddresses results as base places
  const deduplicatedPlaces: Place[] = []
  const nameToPlaceMap: Record<
    string,
    { place: Place; nameKey: string; point?: TurfPoint }
  > = {}

  // Add OSM and OpenAddresses results first
  const osmOpenAddressesResults = [
    ...(placesBySource[SOURCE.OSM] || []),
    ...(placesBySource[SOURCE.OPENADDRESSES] || []),
  ]

  osmOpenAddressesResults.forEach((place) => {
    const nameKey = normalizeName(place.name.value)
    const point = createTurfPoint(place)
    deduplicatedPlaces.push(place)
    nameToPlaceMap[place.id] = { place, nameKey, point }
  })

  // Process other providers
  Object.entries(placesBySource).forEach(([providerId, providerPlaces]) => {
    // Skip OSM/OpenAddresses as we already processed them
    if (providerId === SOURCE.OSM || providerId === SOURCE.OPENADDRESSES) return

    providerPlaces.forEach((place) => {
      const normalizedName = normalizeName(place.name.value)
      const placePoint = createTurfPoint(place)

      let matchFound = false

      // Compare with existing places
      for (const {
        place: existingPlace,
        nameKey,
        point: existingPoint,
      } of Object.values(nameToPlaceMap)) {
        // Skip if provider is the same
        if (existingPlace.sources[0]?.id === place.sources[0]?.id) continue

        // Check for name similarity
        const isSimilarName = nameKey === normalizedName

        // Safety check: ensure both names are strings
        const placeName =
          typeof place.name?.value === 'string'
            ? place.name.value
            : String(place.name?.value || '')
        const existingPlaceName =
          typeof existingPlace.name?.value === 'string'
            ? existingPlace.name.value
            : String(existingPlace.name?.value || '')

        const nameSimilarity = calculateNameSimilarity(
          placeName,
          existingPlaceName,
        )

        let isMatch = false

        // If names are similar, check addresses
        if (isSimilarName) {
          isMatch = doAddressesMatch(place, existingPlace)
        }

        // If name matches but address doesn't, check geographic proximity
        if (isSimilarName && !isMatch && placePoint && existingPoint) {
          const distance = turf.distance(placePoint, existingPoint) * 1000 // convert km to meters
          isMatch = distance < 100 // less than 100 meters
        }

        // Final check: high name similarity + geographic proximity
        const shouldMerge =
          (isSimilarName && isMatch) ||
          (nameSimilarity > 0.85 &&
            arePointsClose(placePoint, existingPoint, 150)) ||
          // More lenient for very close places (within 50 meters) with decent name similarity
          (nameSimilarity > 0.8 &&
            arePointsClose(placePoint, existingPoint, 50)) ||
          // Even more lenient for extremely close places (within 10 meters) with basic name similarity
          (nameSimilarity > 0.7 &&
            arePointsClose(placePoint, existingPoint, 10))

        if (shouldMerge) {
          const mergedPlace = mergePlaces(existingPlace, place)

          // Update the existing place in the deduplicatedPlaces array
          const existingIndex = deduplicatedPlaces.findIndex(
            (p) => p.id === existingPlace.id,
          )
          if (existingIndex !== -1) {
            deduplicatedPlaces[existingIndex] = mergedPlace
          }

          // Update the nameToPlaceMap
          nameToPlaceMap[existingPlace.id] = {
            place: mergedPlace,
            nameKey,
            point: existingPoint,
          }

          matchFound = true
          break
        }
      }

      // If no match found, add as a new place
      if (!matchFound) {
        deduplicatedPlaces.push(place)
        nameToPlaceMap[place.id] = {
          place,
          nameKey: normalizedName,
          point: placePoint,
        }
      }
    })
  })

  return deduplicatedPlaces
}

/**
 * Smart address merging that considers address quality, not just source priority
 * @param target The target address
 * @param source The source address to merge from
 * @param placeName The name of the place (to detect if it's incorrectly included in address)
 * @returns The best quality address
 */
function mergeAddressValue(
  target: AttributedValue<any> | null,
  source: AttributedValue<any> | null,
  placeName: string,
): AttributedValue<any> | null {
  if (!source) return target
  if (!target) return cloneDeep(source)

  // Helper function to check if an address has good street-level data
  const hasStreetLevelData = (address: any): boolean => {
    if (!address?.value) return false

    // Check if we have street1 field with house number (OSM format)
    if (address.value.street1) {
      const numbers = extractAddressNumbers(address.value.street1)
      return numbers.length > 0
    }

    // Check formatted address for any numeric patterns
    if (address.value.formatted) {
      const numbers = extractAddressNumbers(address.value.formatted)
      return numbers.length > 0
    }

    return false
  }

  // Helper function to check if an address has street name information
  const hasStreetName = (address: any): boolean => {
    if (!address?.value) return false

    // OSM always includes street name in street1 if it exists
    if (address.value.street1) return true

    // For formatted addresses, check if it has substantial text content
    // (more than just numbers and basic punctuation)
    if (address.value.formatted) {
      const normalized = normalizeAddress(address.value.formatted)
      // Remove numbers and check if there's meaningful text left
      const withoutNumbers = normalized.replace(/\d+[a-zA-Z]?/g, '').trim()
      return withoutNumbers.length > 3 // At least some street name content
    }

    return false
  }

  // Helper function to check if formatted address incorrectly includes place name
  const addressIncludesPlaceName = (
    address: any,
    placeName: string,
  ): boolean => {
    if (!address?.value?.formatted || !placeName) return false

    const normalizedAddress = address.value.formatted.toLowerCase()
    const normalizedPlaceName = placeName.toLowerCase()

    return normalizedAddress.startsWith(normalizedPlaceName + ',')
  }

  const targetHasStreetData = hasStreetLevelData(target)
  const sourceHasStreetData = hasStreetLevelData(source)
  const targetHasStreetName = hasStreetName(target)
  const sourceHasStreetName = hasStreetName(source)
  const targetIncludesName = addressIncludesPlaceName(target, placeName)
  const sourceIncludesName = addressIncludesPlaceName(source, placeName)

  // If target includes place name but source doesn't, prefer source
  if (targetIncludesName && !sourceIncludesName) {
    return cloneDeep(source)
  }

  // If source includes place name but target doesn't, prefer target
  if (sourceIncludesName && !targetIncludesName) {
    return target
  }

  // Conservative approach: If target has any street information, keep it
  // Only override if target is clearly incomplete and source is better
  if (targetHasStreetName || targetHasStreetData) {
    // Only override if source has street number and target doesn't
    if (!targetHasStreetData && sourceHasStreetData) {
      return cloneDeep(source)
    }

    // If both have good street data, respect source priority
    if (
      (sourceHasStreetData || sourceHasStreetName) &&
      (targetHasStreetData || targetHasStreetName)
    ) {
      const targetPriority = getSourcePriority(target.sourceId)
      const sourcePriority = getSourcePriority(source.sourceId)

      if (sourcePriority > targetPriority) {
        return cloneDeep(source)
      }
    }

    // Otherwise, keep the target
    return target
  }

  // If target has no street info but source does, use source
  if (sourceHasStreetData || sourceHasStreetName) {
    return cloneDeep(source)
  }

  // If neither has good street data, fall back to source priority
  const targetPriority = getSourcePriority(target.sourceId)
  const sourcePriority = getSourcePriority(source.sourceId)

  return sourcePriority > targetPriority ? cloneDeep(source) : target
}

/**
 * Generic function to merge AttributedValue instances based on source priority
 * @param target The target AttributedValue
 * @param source The source AttributedValue to merge from
 * @returns The resulting AttributedValue (choosing higher priority source)
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
 * @param target The target record of AttributedValues
 * @param source The source record to merge from
 * @returns The merged record
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
 * Merges multiple Place objects into one, prioritizing data based on source priorities
 *
 * @param primaryPlace The base place to merge data into
 * @param additionalPlaces Additional places to merge data from
 * @returns A new merged Place object
 */
export function mergePlaces(
  primaryPlace: Place,
  ...additionalPlaces: (Place | null)[]
): Place {
  // Remove null values from additionalPlaces
  const validPlaces = additionalPlaces.filter((p): p is Place => p !== null)
  if (validPlaces.length === 0) return cloneDeep(primaryPlace)

  // All places to consider for merging
  const allPlaces = [primaryPlace, ...validPlaces]

  // Determine the primary ID based on source priorities
  const primaryId = getPrimaryIdFromPlaces(allPlaces)

  // Create a deep copy of the primary place to avoid modifying the original
  const result = cloneDeep(primaryPlace)

  // Update the primary ID
  result.id = primaryId

  for (const place of validPlaces) {
    // Merge external IDs (always accumulative)
    Object.entries(place.externalIds).forEach(([sourceId, id]) => {
      result.externalIds[sourceId] = id
    })

    // Merge name (AttributedValue)
    result.name = mergeAttributedValue(result.name, place.name) || result.name

    // Merge description if present
    if (place.description) {
      result.description = mergeAttributedValue(
        result.description,
        place.description,
      )
    }

    // Merge place type
    result.placeType =
      mergeAttributedValue(result.placeType, place.placeType) ||
      result.placeType

    // Merge geometry (prefer more detailed geometries)
    const primaryGeometryType = result.geometry.value.type
    const placeGeometryType = place.geometry.value.type

    if (
      (primaryGeometryType === 'point' && placeGeometryType !== 'point') ||
      mergeAttributedValue(result.geometry, place.geometry) === place.geometry
    ) {
      result.geometry = cloneDeep(place.geometry)
    }

    // Merge photos without duplicates
    if (place.photos.length > 0) {
      const existingUrls = new Set(
        result.photos.map((photo) => photo.value.url),
      )

      for (const photo of place.photos) {
        if (!existingUrls.has(photo.value.url)) {
          result.photos.push(cloneDeep(photo))
          existingUrls.add(photo.value.url)
        }
      }
    }

    // Merge address if present
    if (place.address) {
      result.address = mergeAddressValue(
        result.address,
        place.address,
        place.name.value,
      )
    }

    // Merge contact info fields
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

    // Merge social media links
    if (place.contactInfo.socials) {
      result.contactInfo.socials = mergeAttributedRecord(
        result.contactInfo.socials,
        place.contactInfo.socials,
      )
    }

    // Merge opening hours
    if (place.openingHours) {
      result.openingHours = mergeAttributedValue(
        result.openingHours,
        place.openingHours,
      )
    }

    // Merge amenities
    if (place.amenities) {
      result.amenities = mergeAttributedRecord(
        result.amenities,
        place.amenities,
      )
    }

    // Merge ratings
    if (place.ratings) {
      if (!result.ratings) {
        result.ratings = cloneDeep(place.ratings)
      } else {
        if (place.ratings.rating) {
          result.ratings.rating =
            mergeAttributedValue(
              result.ratings?.rating || null,
              place.ratings.rating,
            ) || result.ratings.rating
        }

        if (place.ratings.reviewCount) {
          result.ratings.reviewCount =
            mergeAttributedValue(
              result.ratings?.reviewCount || null,
              place.ratings.reviewCount,
            ) || result.ratings.reviewCount
        }
      }
    }

    // Merge source references
    if (place.sources && place.sources.length > 0) {
      const existingSourceIds = new Set(result.sources.map((src) => src.id))

      for (const source of place.sources) {
        if (!existingSourceIds.has(source.id)) {
          result.sources.push(cloneDeep(source))
          existingSourceIds.add(source.id)
        }
      }
    }
  }

  return result
}

/**
 * Gets the highest priority source from a place's sources
 */
function getPlaceSourcePriority(place: Place): number {
  if (!place.sources || place.sources.length === 0) return 0

  return Math.max(
    ...place.sources.map((source) => getSourcePriority(source.id)),
  )
}

/**
 * Determines the primary ID for a merged place based on source priorities
 * @param places Array of places to merge
 * @returns The ID that should be used as the primary ID
 */
function getPrimaryIdFromPlaces(places: Place[]): string {
  if (places.length === 0) return 'unknown/unknown'
  if (places.length === 1) return places[0].id

  // Sort places by source priority (highest first)
  const sortedPlaces = places.sort((a, b) => {
    const aPriority = getPlaceSourcePriority(a)
    const bPriority = getPlaceSourcePriority(b)
    return bPriority - aPriority
  })

  return sortedPlaces[0].id
}

/**
 * Merges and deduplicates places from multiple sources
 *
 * @param places Array of Place objects to merge and deduplicate
 * @returns Array of deduplicated Place objects
 */
export function mergePlacesCollection(places: Place[]): Place[] {
  if (places.length <= 1) return places

  const groups: Place[][] = []

  for (const place of places) {
    let merged = false

    for (const group of groups) {
      const representative = group[0]

      // Calculate similarity scores
      // Safety check: ensure both names are strings
      const placeName =
        typeof place.name?.value === 'string'
          ? place.name.value
          : String(place.name?.value || '')
      const representativeName =
        typeof representative.name?.value === 'string'
          ? representative.name.value
          : String(representative.name?.value || '')

      const nameSimilarity = calculateNameSimilarity(
        placeName,
        representativeName,
      )

      // Create geometry points for distance calculation
      const placePoint = createTurfPoint(place)
      const repPoint = createTurfPoint(representative)

      // Check for geographic proximity
      const areClose = arePointsClose(placePoint, repPoint, 200) // 200 meters threshold

      // Do addresses match?
      const addressMatch = doAddressesMatch(place, representative)

      // Determine if they're the same place based on our criteria
      const hasCoordinates = placePoint && repPoint

      if (hasCoordinates) {
        // Use improved merging logic with multiple threshold levels
        const shouldMerge =
          (nameSimilarity > 0.85 &&
            arePointsClose(placePoint, repPoint, 150)) ||
          // More lenient for very close places (within 50 meters) with decent name similarity
          (nameSimilarity > 0.8 && arePointsClose(placePoint, repPoint, 50)) ||
          // Even more lenient for extremely close places (within 10 meters) with basic name similarity
          (nameSimilarity > 0.7 && arePointsClose(placePoint, repPoint, 10)) ||
          // Address-based matching
          (nameSimilarity > 0.7 && addressMatch) ||
          (areClose && addressMatch)

        if (shouldMerge) {
          group.push(place)
          merged = true
          break
        }
      } else {
        // When coordinates are missing, be much more conservative
        // Only merge if we have perfect name match AND address match
        // This prevents merging different locations of the same chain
        if (nameSimilarity === 1.0 && addressMatch) {
          group.push(place)
          merged = true
          break
        }
      }
    }

    if (!merged) {
      groups.push([place])
    }
  }

  return groups.map((group) => {
    if (group.length === 1) return group[0]

    // Sort by priority: Google first, then OSM, then others
    const sortedGroup = group.sort((a, b) => {
      const aPriority = getSourcePriority(a.sources[0]?.id || '')
      const bPriority = getSourcePriority(b.sources[0]?.id || '')
      return aPriority - bPriority
    })

    // Merge all places in the group, starting with highest priority
    const [primary, ...additional] = sortedGroup
    return mergePlaces(primary, ...additional)
  })
}
