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

const COORDINATES =
  /^\s*\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?\s*$/

/** Coordinates a model wrote as text: `{"lat": 40.6, "lng": -73.9}` or `40.6, -73.9`. */
export function parsePointText(text: string): AskEndpoint | null {
  try {
    const value = JSON.parse(text)
    if (typeof value?.lat === 'number' && typeof value?.lng === 'number') {
      return {
        lat: value.lat,
        lng: value.lng,
        ...(typeof value.name === 'string' && { name: value.name }),
      }
    }
  } catch {}
  const match = COORDINATES.exec(text)
  if (!match) return null
  const [lat, lng] = [Number(match[1]), Number(match[2])]
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null
}
