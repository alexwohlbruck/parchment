// Import the types from the server
import type {
  UnifiedPlace,
  PlaceGeometry,
  Address,
  OpeningHours,
  PlacePhoto,
  SourceReference,
  SourceId,
  Coordinates,
  OpeningTime,
  Amenity,
  AttributedValue,
} from '@server/types/unified-place.types'

// Re-export for use in client code
export type {
  UnifiedPlace,
  PlaceGeometry,
  Address,
  OpeningHours,
  PlacePhoto,
  SourceReference,
  SourceId,
  Coordinates,
  OpeningTime,
  Amenity,
  AttributedValue,
}

export function getPrimaryPhoto(place: UnifiedPlace): PlacePhoto | null {
  return place.photos.find(photo => photo.isPrimary) || null
}

export function getLogoPhoto(place: UnifiedPlace): PlacePhoto | null {
  return place.photos.find(photo => photo.isLogo) || null
}

export function getSourceById(
  place: UnifiedPlace,
  sourceId: SourceId,
): SourceReference | null {
  return place.sources.find(source => source.id === sourceId) || null
}

export function getFormattedAddress(place: UnifiedPlace): string | null {
  return place.address?.formatted || null
}
