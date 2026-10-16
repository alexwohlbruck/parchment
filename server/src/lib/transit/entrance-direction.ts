/**
 * Entrances that reach only one direction's platform.
 *
 * A station with side platforms and no crossover inside fare control has
 * entrances signed for one direction. Mappers put that in the entrance's name
 * or description, either as a compass word ("6 trains Uptown & The Bronx") or
 * as a destination ("R trains to Manhattan"), sometimes per line ("all F,G
 * trains; R trains to Manhattan").
 */

import type { Coordinate } from '../../types/unified-routing.types'

/** What an entrance is signed for: a compass heading or a named destination. */
export type EntranceSign = { heading: number } | { toward: string }

const HEADING_TERMS: Array<[RegExp, number]> = [
  [/\b(uptown|north\s*-?bound)\b/i, 0],
  [/\b(east\s*-?bound)\b/i, 90],
  [/\b(downtown|south\s*-?bound)\b/i, 180],
  [/\b(west\s*-?bound)\b/i, 270],
]

const TRAINS_CLAUSE = /^\s*(?:all\s+)?(?:([\w<>]{1,4}(?:\s*,\s*[\w<>]{1,4})*)\s+)?trains?\b(.*)$/i
const TOWARD = /^\s*to\s+(.+?)\s*$/i
const BOUND = /^\s*(.+?)[\s-]+bound\b/i

interface Clause {
  routes: string[] | null
  sign: EntranceSign | null
}

const routeKey = (route: string) => route.replace(/[<>]/g, '').trim().toLowerCase()

function compassHeading(text: string): number | null {
  const headings = new Set(HEADING_TERMS.filter(([re]) => re.test(text)).map(([, h]) => h))
  return headings.size === 1 ? [...headings][0] : null
}

function parseClause(text: string): Clause {
  const trains = TRAINS_CLAUSE.exec(text)
  const routes = trains?.[1] ? trains[1].split(',').map(routeKey) : null
  const heading = compassHeading(text)
  if (heading != null) return { routes, sign: { heading } }
  const toward = (trains ? TOWARD.exec(trains[2]) ?? BOUND.exec(trains[2]) : BOUND.exec(text))?.[1]
  return { routes, sign: toward ? { toward } : null }
}

const signKey = (sign: EntranceSign) =>
  'heading' in sign ? `h:${sign.heading}` : `t:${sign.toward.toLowerCase()}`

/**
 * The single direction an entrance is signed for on the given routes, or
 * null when it serves either or the sign can't be read. A clause naming one
 * of the routes decides; with none, every clause on the sign is considered.
 */
export function entranceSign(
  routes: string[],
  ...labels: Array<string | null | undefined>
): EntranceSign | null {
  const clauses = labels
    .filter((l): l is string => !!l)
    .flatMap((l) => l.split(';'))
    .map(parseClause)
  const wanted = new Set(routes.map(routeKey))
  const own = clauses.filter((c) => c.routes?.some((r) => wanted.has(r)))
  if (own.some((c) => c.sign == null)) return null
  const signs = (own.length ? own : clauses).flatMap((c) => (c.sign ? [c.sign] : []))
  const distinct = new Map(signs.map((s) => [signKey(s), s]))
  return distinct.size === 1 ? [...distinct.values()][0] : null
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
