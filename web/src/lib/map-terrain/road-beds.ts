/**
 * Road beds from barrelman: stretches of a road on the ground whose
 * carriageway the terrain does not hold level, its embankment's walls blurred
 * into slopes. The ground under the carriageway is filled up to the
 * centreline's height, so the road and its paint lie flat across instead of
 * leaning and wobbling where its outer lanes run down those slopes. Only ever
 * up: beds side by side then meet at the higher, rather than fight.
 */
import { mercator, parseLine, parseProfile, type Point } from '@/lib/map-decks/decks'
import { footprint, type Footprint } from './carve'

/** A bed as served: its centreline, the height along it in metres, and its half width. */
export type ServedBed = { key: string; points: Point[]; floor: number[]; half: number }

/** Metres past the carriageway over which the fill banks down to the ground: an embankment's wall, steepened. */
const BANK_OUT = 2

/** A bed from a `tunnel_cuts` tile feature of kind `bed`, or null for one that does not hold together. */
export function parseBed(props: Record<string, any>): ServedBed | null {
  if (props.kind !== 'bed') return null
  const points = parseLine(props.line).map(mercator)
  const floor = parseProfile(props.floor)
  const half = Number(props.left_edge)
  if (points.length < 2 || floor.length !== points.length || !(half > 0)) return null
  return { key: String(props.id), points, floor, half }
}

/** The ground filled up under a bed to its floor. */
export function bedCarving({ points, floor, half }: ServedBed): Footprint {
  return footprint(points, floor, [floor, floor], [half, half], [half, half], [half + BANK_OUT, half + BANK_OUT], true)
}
