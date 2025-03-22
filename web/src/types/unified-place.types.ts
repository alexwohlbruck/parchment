// Import the types from the server
import type {
  UnifiedPlace,
  AttributedValue,
  PlaceGeometry,
  Address,
  OpeningHours,
  PlacePhoto,
  SourceReference,
  SourceId,
  Coordinates,
  OpeningTime,
  Amenity,
} from '@server/types/unified-place.types'

import { selectBestValue } from '@server/types/unified-place.types'

// Re-export for use in client code
export type {
  UnifiedPlace,
  AttributedValue,
  PlaceGeometry,
  Address,
  OpeningHours,
  PlacePhoto,
  SourceReference,
  SourceId,
  Coordinates,
  OpeningTime,
  Amenity,
}

export { selectBestValue }

// Convenience utilities for the client
export function getBestName(place: UnifiedPlace): string {
  return selectBestValue(place.name) || 'Unnamed Place'
}

export function getBestPlaceType(place: UnifiedPlace): string {
  return selectBestValue(place.placeType) || 'Place'
}

export function getBestAddress(place: UnifiedPlace): Address | null {
  return selectBestValue(place.address)
}

export function getBestPhone(place: UnifiedPlace): string | null {
  return selectBestValue(place.contactInfo.phone)
}

export function getBestEmail(place: UnifiedPlace): string | null {
  return selectBestValue(place.contactInfo.email)
}

export function getBestWebsite(place: UnifiedPlace): string | null {
  return selectBestValue(place.contactInfo.website)
}

export function getPrimaryPhoto(place: UnifiedPlace): PlacePhoto | null {
  return place.photos.find(photo => photo.isPrimary) || place.photos[0] || null
}

export function getLogoPhoto(place: UnifiedPlace): PlacePhoto | null {
  return place.photos.find(photo => photo.isLogo) || null
}

export function getOpeningHours(place: UnifiedPlace): OpeningHours | null {
  return selectBestValue(place.openingHours)
}

export function getSourceById(
  place: UnifiedPlace,
  sourceId: SourceId,
): SourceReference | null {
  return place.sources.find(source => source.id === sourceId) || null
}

export function getFormattedAddress(place: UnifiedPlace): string | null {
  const address = getBestAddress(place)
  return address?.formatted || null
}
