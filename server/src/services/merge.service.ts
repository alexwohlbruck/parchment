import type { AttributedValue } from '../types/unified-place.types'
import { SOURCE, SOURCE_PRIORITIES } from '../lib/constants'
import * as turf from '@turf/turf'
import type { UnifiedPlace } from '../types/unified-place.types'
import { googleAdapter } from '../adapters/google-adapter'
import type { PlaceDataAdapter } from '../types/adapter.types'
import { Feature, Point } from 'geojson'

type TurfPoint = Feature<Point>

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
 * Merge place data from different sources
 */

export function mergePlaceData(
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

/**
 * Gets the priority of a data source
 * Higher value = higher priority
 */
export function getSourcePriority(sourceId: string): number {
  return SOURCE_PRIORITIES[sourceId as keyof typeof SOURCE_PRIORITIES] || 0
}

/**
 * Registers a new data source with a priority
 * Can be used to dynamically add new sources or change priorities
 */
export function registerSourcePriority(
  sourceId: string,
  priority: number,
): void {
  ;(SOURCE_PRIORITIES as Record<string, number>)[sourceId] = priority
}

/**
 * Merges a new attributed value with existing values based on source priority
 * Higher priority sources replace lower priority ones
 * Equal priority sources are added to the list
 */
export function mergeAttributedValues<T>(
  existing: AttributedValue<T>[],
  newValue: AttributedValue<T>,
): AttributedValue<T>[] {
  if (!existing || existing.length === 0) {
    return [newValue]
  }

  const existingPriority = getSourcePriority(existing[0]?.sourceId || '')
  const newPriority = getSourcePriority(newValue.sourceId)

  if (newPriority > existingPriority) {
    return [newValue]
  }

  if (newPriority < existingPriority) {
    return existing
  }

  return [...existing, newValue]
}

/**
 * Selects the best value from a list of attributed values based on source priority
 */
export function selectBestValue<T>(values: AttributedValue<T>[]): T | null {
  if (!values || values.length === 0) return null
  if (values.length === 1) return values[0].value

  return values.sort((a, b) => {
    const priorityA = getSourcePriority(a.sourceId)
    const priorityB = getSourcePriority(b.sourceId)
    return priorityB - priorityA
  })[0].value
}

/**
 * Merges records of attributed values, respecting source priorities
 */
export function mergeAttributedRecords<T>(
  existing: Record<string, AttributedValue<T>[]> | undefined,
  newRecord: Record<string, AttributedValue<T>[]>,
): Record<string, AttributedValue<T>[]> {
  const result: Record<string, AttributedValue<T>[]> = { ...(existing || {}) }

  Object.entries(newRecord).forEach(([key, values]) => {
    if (!values || values.length === 0) return

    if (!result[key]) {
      result[key] = [...values]
      return
    }

    // Merge each new value into the existing array
    values.forEach((value) => {
      result[key] = mergeAttributedValues(result[key], value)
    })
  })

  return result
}

/**
 * Standard ISO date string format for consistency across the application
 */
export function getTimestamp(): string {
  return new Date().toISOString()
}

/**
 * Groups places by their provider
 * Used to deduplicate places across providers
 */
export function groupPlacesByProvider(
  places: UnifiedPlace[],
): Record<string, UnifiedPlace[]> {
  const placesByProvider: Record<string, UnifiedPlace[]> = {}

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

export function getAddressString(place: UnifiedPlace): string | null {
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

export function getStreetNumber(address: string): string | null {
  const match = address.match(/^\d+/)
  return match ? match[0] : null
}

export function createTurfPoint(place: UnifiedPlace): TurfPoint | undefined {
  if (
    place.geometry.center &&
    place.geometry.center.lat !== 0 &&
    place.geometry.center.lng !== 0
  ) {
    return turf.point([place.geometry.center.lng, place.geometry.center.lat])
  }
  return undefined
}

export function doAddressesMatch(
  place1: UnifiedPlace,
  place2: UnifiedPlace,
): boolean {
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

export function mergePlaceWithAdapter(
  primaryPlace: UnifiedPlace,
  secondaryPlace: UnifiedPlace,
  providerId: string,
): void {
  // Preserve external IDs from both sources
  if (secondaryPlace.externalIds) {
    Object.entries(secondaryPlace.externalIds).forEach(
      ([idSource, idValue]) => {
        primaryPlace.externalIds[idSource] = idValue
      },
    )
  }

  // Find the appropriate adapter for this provider
  let adapter: PlaceDataAdapter
  if (providerId === SOURCE.GOOGLE) {
    adapter = googleAdapter
  } else {
    console.log(`No adapter found for provider ${providerId}, skipping merge`)
    return
  }

  mergePlaceData(primaryPlace, adapter, secondaryPlace)
}

/**
 * Looks for duplicate places across providers and merges them
 */
export function deduplicateAutocompletePlaces(
  places: UnifiedPlace[],
  coordinates?: { lat: number; lng: number },
): UnifiedPlace[] {
  if (!places.length) return []

  console.log(
    `Deduplicating ${places.length} autocomplete places across providers`,
  )

  // Group places by provider
  const placesByProvider = groupPlacesByProvider(places)

  // First priority: Add all OSM/Pelias results as base places
  const finalResults: UnifiedPlace[] = []
  const nameToPlaceMap: Record<
    string,
    { place: UnifiedPlace; nameKey: string; point?: TurfPoint }
  > = {}

  // Add OSM and Pelias results first
  const osmPeliasResults = [
    ...(placesByProvider[SOURCE.OSM] || []),
    ...(placesByProvider[SOURCE.PELIAS] || []),
  ]

  osmPeliasResults.forEach((place) => {
    const nameKey = normalizeName(place.name)
    const point = createTurfPoint(place)
    finalResults.push(place)
    nameToPlaceMap[place.id] = { place, nameKey, point }
  })

  // Process other providers
  Object.entries(placesByProvider).forEach(([providerId, providerPlaces]) => {
    // Skip OSM/Pelias as we already processed them
    if (providerId === SOURCE.OSM || providerId === SOURCE.PELIAS) return

    providerPlaces.forEach((place) => {
      const normalizedName = normalizeName(place.name)
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
        let isMatch = false

        // If names are similar, check addresses
        if (isSimilarName) {
          isMatch = doAddressesMatch(place, existingPlace)
        }

        // If name matches but address doesn't, check geographic proximity
        if (isSimilarName && !isMatch) {
          isMatch = arePointsClose(placePoint, existingPoint)
        }

        // Final check: high name similarity + geographic proximity
        const shouldMerge =
          (isSimilarName && isMatch) ||
          (calculateNameSimilarity(place.name, existingPlace.name) > 0.85 &&
            arePointsClose(placePoint, existingPoint, 150))

        if (shouldMerge) {
          console.log(
            `Merging duplicate ${providerId} place: ${place.name} into existing place`,
          )
          mergePlaceWithAdapter(existingPlace, place, providerId)
          matchFound = true
          break
        }
      }

      // If no match found, add as a new place
      if (!matchFound) {
        console.log(`No match found for ${place.name}, adding as new place`)
        finalResults.push(place)
        nameToPlaceMap[place.id] = {
          place,
          nameKey: normalizedName,
          point: placePoint,
        }
      }
    })
  })

  console.log(
    `Returned ${finalResults.length} deduplicated places (original: ${places.length})`,
  )
  return finalResults
}
