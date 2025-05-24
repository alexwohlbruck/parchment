import { Place } from '../types/place.types'
import { AutocompletePrediction } from '../types/place.types'

// TODO: I Think this service/file is unnecessary
/**
 * Transform a Place object into an AutocompletePrediction format
 * @param place The Place object to transform
 * @param provider The provider identifier (e.g., 'nominatim', 'overpass')
 * @returns An AutocompletePrediction object
 */
export function transformPlaceForAutocomplete(
  place: Place,
  provider: string,
): AutocompletePrediction {
  // Extract basic information
  const name = place.tags?.name || place.tags?.['brand:name'] || 'Unknown place'

  // Create a description from address parts if available
  let secondaryText = ''
  if (place.tags) {
    const addressParts = []

    if (place.tags['addr:housenumber'] && place.tags['addr:street']) {
      addressParts.push(
        `${place.tags['addr:housenumber']} ${place.tags['addr:street']}`,
      )
    } else if (place.tags['addr:street']) {
      addressParts.push(place.tags['addr:street'])
    }

    if (place.tags['addr:city']) {
      addressParts.push(place.tags['addr:city'])
    } else if (place.tags['addr:town']) {
      addressParts.push(place.tags['addr:town'])
    } else if (place.tags['addr:village']) {
      addressParts.push(place.tags['addr:village'])
    }

    if (place.tags['addr:state']) {
      addressParts.push(place.tags['addr:state'])
    }

    if (addressParts.length > 0) {
      secondaryText = addressParts.join(', ')
    }
  }

  // Extract place type information
  const types: string[] = []
  if (place.tags) {
    if (place.tags.amenity) types.push(place.tags.amenity)
    if (place.tags.shop) types.push(`shop=${place.tags.shop}`)
    if (place.tags.tourism) types.push(`tourism=${place.tags.tourism}`)
    if (place.tags.leisure) types.push(`leisure=${place.tags.leisure}`)
    if (place.tags.office) types.push(`office=${place.tags.office}`)
    if (place.tags.building) types.push(`building=${place.tags.building}`)
  }

  // Create the prediction
  return {
    placeId: `${provider}/${place.id}`,
    description: secondaryText ? `${name}, ${secondaryText}` : name,
    mainText: name,
    secondaryText: secondaryText,
    types: types.length > 0 ? types : ['place'],
    provider: provider,
    lat: place.center?.lat,
    lng: place.center?.lon,
  }
}
