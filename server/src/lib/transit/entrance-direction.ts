/**
 * Entrances that reach only one direction's platform.
 *
 * A station with side platforms and no crossover inside fare control has
 * entrances signed for one direction — "6 trains Uptown & The Bronx" at
 * 86 St. Mappers put that in the entrance's name or description; the words
 * are read as a compass heading and compared with the way the train leaves.
 */

import type { Coordinate } from '../../types/unified-routing.types'

const HEADING_TERMS: Array<[RegExp, number]> = [
  [/\b(uptown|north\s*-?bound)\b/i, 0],
  [/\b(east\s*-?bound)\b/i, 90],
  [/\b(downtown|south\s*-?bound)\b/i, 180],
  [/\b(west\s*-?bound)\b/i, 270],
]

/** The single heading an entrance is signed for, or null when it serves any. */
export function entranceHeading(...labels: Array<string | null | undefined>): number | null {
  const text = labels.filter(Boolean).join(' ')
  const headings = new Set(HEADING_TERMS.filter(([re]) => re.test(text)).map(([, h]) => h))
  return headings.size === 1 ? [...headings][0] : null
}

/** Initial compass bearing from `a` to `b`, in degrees. */
export function bearingDeg(a: Coordinate, b: Coordinate): number {
  const rad = Math.PI / 180
  const dLng = (b.lng - a.lng) * rad
  const y = Math.sin(dLng) * Math.cos(b.lat * rad)
  const x =
    Math.cos(a.lat * rad) * Math.sin(b.lat * rad) -
    Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos(dLng)
  return (Math.atan2(y, x) / rad + 360) % 360
}

/**
 * True when the entrance is signed for the other direction. "Uptown" leans
 * with a street grid rather than true north, hence the generous quarter-turn.
 */
export function entranceFacesAway(heading: number | null, travelBearing: number | null): boolean {
  if (heading == null || travelBearing == null) return false
  const diff = Math.abs(((heading - travelBearing + 540) % 360) - 180)
  return diff > 90
}
