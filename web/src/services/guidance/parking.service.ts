import { api } from '@/lib/api'
import type { LngLat } from '@/types/map.types'
import type { Place } from '@/types/place.types'

const METERS_PER_DEGREE = 111_320

/** Car parks within `radius` metres of `center`, nearest first. */
export async function fetchParkingNear(center: LngLat, radius: number, signal?: AbortSignal): Promise<Place[]> {
  const dLat = radius / METERS_PER_DEGREE
  const dLng = radius / (METERS_PER_DEGREE * Math.cos((center.lat * Math.PI) / 180))
  const { data } = await api.post(
    '/search/category',
    {
      presetId: 'amenity/parking',
      bounds: { north: center.lat + dLat, south: center.lat - dLat, east: center.lng + dLng, west: center.lng - dLng },
      maxResults: 25,
      sort: 'distance',
    },
    { signal },
  )
  return data?.results ?? []
}
