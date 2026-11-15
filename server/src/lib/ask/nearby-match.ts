import { distance } from '@turf/turf'
import type { LatLng } from '../../types/ask.types'

const NEARBY_KM = 50

interface Named {
  name: { value: string | null }
  geometry: { value: { center: LatLng } }
}

/** Results with the user's own nearby "Prospect Park" first, ahead of a better-known one far away. */
export function nearbyFirst<T extends Named>(results: T[], query: string, near: LatLng | undefined): T[] {
  if (!near) return results
  const wanted = query.trim().toLowerCase()
  const km = (result: T) => {
    const { lat, lng } = result.geometry.value.center
    return distance([near.lng, near.lat], [lng, lat], { units: 'kilometers' })
  }
  const local = results
    .filter((result) => result.name.value?.trim().toLowerCase() === wanted && km(result) <= NEARBY_KM)
    .sort((a, b) => km(a) - km(b))
  return [...local, ...results.filter((result) => !local.includes(result))]
}
