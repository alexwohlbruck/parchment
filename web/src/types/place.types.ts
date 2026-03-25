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
  TransitDeparture,
  TransitStopInfo,
  PlaceRelation,
  PlaceCategory,
  PlaceIcon,
  WidgetDescriptor,
  WidgetResponse,
} from '@server/types/place.types'

import { WidgetType } from '@server/types/place.types'

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
  TransitDeparture,
  TransitStopInfo,
  PlaceRelation,
  PlaceCategory,
  PlaceIcon,
  WidgetDescriptor,
  WidgetResponse,
}

export { WidgetType }

// TODO: Move out of types
export function getPrimaryPhoto(place: Partial<Place> | null): PlacePhoto | null {
  if (!place?.photos) return null
  const primaryPhoto = place.photos.find(photo => photo.value.isPrimary)
  return primaryPhoto ? primaryPhoto.value : null
}

// TODO: Move out of types
export function getLogoPhoto(place: Partial<Place> | null): PlacePhoto | null {
  if (!place?.photos) return null
  const logoPhoto = place.photos.find(photo => photo.value.isLogo)
  return logoPhoto ? logoPhoto.value : null
}

// TODO: Move out of types
export function getSourceById(
  place: Place,
  sourceId: SourceId,
): SourceReference | null {
  return place.sources.find(source => source.id === sourceId) || null
}
