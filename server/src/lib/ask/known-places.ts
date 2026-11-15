import type { AskEndpoint, LatLng } from '../../types/ask.types'

export const HERE = 'here'

/** Names the model may use for points, keyed lower-case. The device's own position is always "here". */
export function knownPlaces(
  here: LatLng | undefined,
  saved: AskEndpoint[] = [],
): Map<string, AskEndpoint> {
  const places = new Map<string, AskEndpoint>()
  if (here) places.set(HERE, { lat: here.lat, lng: here.lng })
  for (const place of saved) {
    const key = place.name?.trim().toLowerCase()
    if (key && !places.has(key)) places.set(key, place)
  }
  return places
}
