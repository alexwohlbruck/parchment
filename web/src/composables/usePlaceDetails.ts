import { computed } from 'vue'
import { Place } from '@/types/map.types'
import { parseOpeningHours } from '@/lib/map.utils'
import {
  getPlaceType,
  getWheelchairAccess,
  getSmokingStatus,
  getRestroomAccess,
} from '@/lib/place.utils'

export function usePlaceDetails(place: Ref<Place | null>) {
  const placeType = computed(() => getPlaceType(place.value?.tags ?? {}))

  const formattedAddress = computed(() => {
    const tags = place.value?.tags
    if (!tags) return ''

    const parts = [
      `${tags['addr:housenumber'] || ''} ${tags['addr:street'] || ''}`.trim(),
      `${tags['addr:city'] || ''}${
        tags['addr:city'] && tags['addr:state'] ? ',' : ''
      } ${tags['addr:state'] || ''} ${tags['addr:postcode'] || ''}`.trim(),
      tags['addr:country'],
    ].filter(Boolean)

    return parts.join('\n')
  })

  const coordinates = computed(() => {
    if (!place.value) return null
    const lat = place.value.center?.lat ?? place.value.lat
    const lon = place.value.center?.lon ?? place.value.lon
    if (!lat || !lon) return null
    return { lat, lon }
  })

  // ... other computed properties

  return {
    placeType,
    formattedAddress,
    coordinates,
    // ... other properties
  }
}
