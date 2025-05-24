// Import the types from the server
import type {
  Place,
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
} from '@server/types/place.types'

// Re-export for use in client code
export type {
  Place,
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

export function getPrimaryPhoto(place: Place): PlacePhoto | null {
  const primaryPhoto = place.photos.find(photo => photo.value.isPrimary)
  return primaryPhoto ? primaryPhoto.value : null
}

export function getLogoPhoto(place: Place): PlacePhoto | null {
  const logoPhoto = place.photos.find(photo => photo.value.isLogo)
  return logoPhoto ? logoPhoto.value : null
}

export function getSourceById(
  place: Place,
  sourceId: SourceId,
): SourceReference | null {
  return place.sources.find(source => source.id === sourceId) || null
}

export function getFormattedAddress(place: Place): string | null {
  return place.address?.value.formatted || null
}
