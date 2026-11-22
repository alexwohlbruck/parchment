import type { Location } from '../../types/valhalla.types'
import type { Waypoint } from '../../types/trip.types'

const HOUSE_NUMBER = /^\s*\d+[\w/-]*\s+/

/** The street an address line is on, without its house number: "139 Rogers Avenue" → "Rogers Avenue". */
export function streetFromAddress(address?: string): string | undefined {
  const line = address?.split(',')[0]
  if (!line || !HOUSE_NUMBER.test(line)) return undefined
  const street = line.replace(HOUSE_NUMBER, '').trim()
  return /\p{L}/u.test(street) ? street : undefined
}

/** A trip waypoint as a routing location, naming its street so the router snaps onto that street. */
export function waypointLocation(wp: Pick<Waypoint, 'location' | 'address'>): Location {
  const street = streetFromAddress(wp.address)
  return {
    type: 'coordinates',
    value: [wp.location.lat, wp.location.lng],
    ...(street && { street }),
  }
}

/** Per-point street hints, or undefined when no point has one. Engines take '' for "no hint". */
export function streetHints(waypoints: { street?: string }[]): string[] | undefined {
  return waypoints.some((wp) => wp.street) ? waypoints.map((wp) => wp.street ?? '') : undefined
}
