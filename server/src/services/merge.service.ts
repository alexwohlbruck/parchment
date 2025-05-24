import type { AttributedValue } from '../types/place.types'
import { SOURCE, SOURCE_PRIORITIES } from '../lib/constants'
import * as turf from '@turf/turf'
import type { Place } from '../types/place.types'
import { Feature, Point } from 'geojson'
import { cloneDeep } from 'lodash'

type TurfPoint = Feature<Point>

// TODO: Overhaul this function
/**
 * Calculate the similarity between two place names
 */
function calculateNameSimilarity(name1: string, name2: string): number {
  if (!name1 || !name2) return 0

  // Simple normalization for comparison
  const normalize = (name: string): string => {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
  }

  const normalized1 = normalize(name1)
  const normalized2 = normalize(name2)

  // Exact match
  if (normalized1 === normalized2) {
    return 1
  }

  // Substring match
  if (normalized1.includes(normalized2) || normalized2.includes(normalized1)) {
    const coverage =
      Math.min(normalized1.length, normalized2.length) /
      Math.max(normalized1.length, normalized2.length)
    return 0.7 + coverage * 0.3
  }

  // Word matching
  const words1 = normalized1.split(' ')
  const words2 = normalized2.split(' ')
  const commonWords = words1.filter((word) => words2.includes(word))

  if (commonWords.length === 0) {
    return 0
  }

  return (commonWords.length * 2) / (words1.length + words2.length)
}

/**
 * Gets the priority of a data source
 * Higher value = higher priority
 */
export function getSourcePriority(sourceId: string): number {
  return SOURCE_PRIORITIES[sourceId as keyof typeof SOURCE_PRIORITIES] || 0
}

/**
 * Groups places by their provider
 * Used to deduplicate places across providers
 */
export function groupPlacesByProvider(
  places: Place[],
): Record<string, Place[]> {
  const placesByProvider: Record<string, Place[]> = {}

  places.forEach((place) => {
    const providerId = place.sources[0]?.id || 'unknown'
    if (!placesByProvider[providerId]) {
      placesByProvider[providerId] = []
    }
    placesByProvider[providerId].push(place)
  })

  return placesByProvider
}

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
}

// TODO: We should not rely on english text for any data processing. This has to work for any language.
export function normalizeAddress(address: string): string {
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
    .replace(/[^\w\s]/g, '')
    .replace(/\d{5}(\-\d{4})?/g, '')
    .trim()
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
  const match = address.match(/^\d+/)
  return match ? match[0] : null
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

export function doAddressesMatch(place1: Place, place2: Place): boolean {
  const address1 = getAddressString(place1)
  const address2 = getAddressString(place2)

  if (!address1 || !address2) return false

  const streetNumber1 = getStreetNumber(address1)
  const streetNumber2 = getStreetNumber(address2)

  // If both have street numbers and they don't match, not the same place
  if (streetNumber1 && streetNumber2 && streetNumber1 !== streetNumber2) {
    return false
  }

  const normalizedAddr1 = normalizeAddress(address1)
  const normalizedAddr2 = normalizeAddress(address2)

  return (
    normalizedAddr1.includes(normalizedAddr2) ||
    normalizedAddr2.includes(normalizedAddr1) ||
    (!!streetNumber1 && !!streetNumber2 && streetNumber1 === streetNumber2)
  )
}

export function arePointsClose(
  point1: TurfPoint | undefined,
  point2: TurfPoint | undefined,
  maxDistanceMeters: number = 100,
): boolean {
  if (!point1 || !point2) return false

  const distanceMeters = turf.distance(point1, point2) * 1000
  return distanceMeters < maxDistanceMeters
}

// TODO: Review this function and simplify
/**
 * Looks for duplicate places from results across providers and merges them
 */
export function deduplicatePlacesResults(places: Place[]): Place[] {
  if (!places.length) return []

  // Group places by provider
  const placesByProvider = groupPlacesByProvider(places)

  // If we only have one provider, return all places from that provider
  if (Object.keys(placesByProvider).length === 1) {
    return places
  }

  // First priority: Add all OSM/OpenAddresses results as base places
  const finalResults: Place[] = []
  const nameToPlaceMap: Record<
    string,
    { place: Place; nameKey: string; point?: TurfPoint }
  > = {}

  // Add OSM and OpenAddresses results first
  const osmOpenAddressesResults = [
    ...(placesByProvider[SOURCE.OSM] || []),
    ...(placesByProvider[SOURCE.OPENADDRESSES] || []),
  ]

  osmOpenAddressesResults.forEach((place) => {
    const nameKey = normalizeName(place.name.value)
    const point = createTurfPoint(place)
    finalResults.push(place)
    nameToPlaceMap[place.id] = { place, nameKey, point }
  })

  // Process other providers
  Object.entries(placesByProvider).forEach(([providerId, providerPlaces]) => {
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
        const nameSimilarity = calculateNameSimilarity(
          place.name.value,
          existingPlace.name.value,
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
            arePointsClose(placePoint, existingPoint, 150))

        if (shouldMerge) {
          mergePlaces(existingPlace, place)
          matchFound = true
          break
        }
      }

      // If no match found, add as a new place
      if (!matchFound) {
        finalResults.push(place)
        nameToPlaceMap[place.id] = {
          place,
          nameKey: normalizedName,
          point: placePoint,
        }
      }
    })
  })

  return finalResults
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

  // Create a deep copy of the primary place to avoid modifying the original
  const result = cloneDeep(primaryPlace)

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
      result.address = mergeAttributedValue(result.address, place.address)
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
 * Determines if the source of place2 has higher priority than place1
 */
function hasHigherPriority(place1: Place, place2: Place): boolean {
  const priority1 = getPlaceSourcePriority(place1)
  const priority2 = getPlaceSourcePriority(place2)

  return priority2 > priority1
}

/**
 * Merges and deduplicates places from multiple sources
 *
 * @param places Array of Place objects to merge and deduplicate
 * @returns Array of deduplicated Place objects
 */
export function mergePlacesCollection(places: Place[]): Place[] {
  if (!places.length) return []

  // Group places by their most likely real-world entity
  // We'll identify similar places based on name, location, and other attributes
  const deduplicationGroups: Place[][] = []

  for (const place of places) {
    let foundMatch = false

    // Check each existing group to see if this place belongs there
    for (const group of deduplicationGroups) {
      const representative = group[0]

      // Calculate similarity scores
      const nameSimilarity = calculateNameSimilarity(
        place.name.value,
        representative.name.value,
      )

      // Create geometry points for distance calculation
      const placePoint = createTurfPoint(place)
      const repPoint = createTurfPoint(representative)

      // Check for geographic proximity
      const areClose = arePointsClose(placePoint, repPoint, 200) // 200 meters threshold

      // Do addresses match?
      const addressMatch = doAddressesMatch(place, representative)

      // Determine if they're the same place based on our criteria
      if (
        (nameSimilarity > 0.85 && areClose) ||
        (nameSimilarity > 0.7 && addressMatch) ||
        (areClose && addressMatch)
      ) {
        // Add to this group
        group.push(place)
        foundMatch = true
        break
      }
    }

    // If no match found, create a new group
    if (!foundMatch) {
      deduplicationGroups.push([place])
    }
  }

  // For each group, merge all places into one
  const results: Place[] = []

  for (const group of deduplicationGroups) {
    if (group.length === 1) {
      // Group has only one place, no merging needed
      results.push(cloneDeep(group[0]))
    } else {
      // Sort by source priority (highest first)
      group.sort((a, b) => {
        const aPriority = getPlaceSourcePriority(a)
        const bPriority = getPlaceSourcePriority(b)
        return bPriority - aPriority
      })

      // Merge all places in the group, starting with highest priority
      let merged = cloneDeep(group[0])

      for (let i = 1; i < group.length; i++) {
        merged = mergePlaces(merged, group[i])
      }

      results.push(merged)
    }
  }

  return results
}
