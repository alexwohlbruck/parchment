/**
 * Road beds from barrelman: stretches of a road on the ground whose
 * carriageway the terrain does not hold level, its embankment's walls blurred
 * into slopes. The ground under the carriageway is filled up to the
 * centreline's height, so the road and its paint lie flat across instead of
 * leaning and wobbling where its outer lanes run down those slopes. Only ever
 * up, so beds side by side meet at the higher rather than fight; except a
 * bed `level`ed both ways, where the terrain is not the road's at all, as
 * under the deck of a double-deck road.
 */
import { mercator, metresPerUnit, parseLine, parseProfile, type Point } from '@/lib/map-decks/decks'
import { footprint, type Footprint } from './carve'

/** A bed as served: its centreline, the height along it in metres, its half width, and whether it lowers the ground too. */
export type ServedBed = { key: string; points: Point[]; floor: number[]; half: number; level: boolean }

/** Metres past the carriageway over which the fill comes down to the ground: near enough a retaining wall, so it keeps off what runs alongside. */
const BANK_OUT = 0.5

/** Metres a bed runs on past each end, under the deck or road it meets, so no ground shows at the joint. */
const RUN_ON = 2

/** A line run on `metres` past each end along its end segments. */
function runOn(points: Point[], metres: number): Point[] {
  const past = (a: Point, b: Point): Point => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    const k = metres / metresPerUnit(b[1]) / length
    return [b[0] + (b[0] - a[0]) * k, b[1] + (b[1] - a[1]) * k]
  }
  return [past(points[1], points[0]), ...points.slice(1, -1), past(points[points.length - 2], points[points.length - 1])]
}

/** A bed from a `tunnel_cuts` tile feature of kind `bed`, or null for one that does not hold together. */
export function parseBed(props: Record<string, any>): ServedBed | null {
  if (props.kind !== 'bed') return null
  const points = parseLine(props.line).map(mercator)
  const floor = parseProfile(props.floor)
  const half = Number(props.left_edge)
  if (points.length < 2 || floor.length !== points.length || !(half > 0)) return null
  return { key: String(props.id), points, floor, half, level: props.under === true }
}

/** The ground filled up under a bed to its floor, and for a level one cut down to it too. */
export function bedCarvings({ points, floor, half, level }: ServedBed): Footprint[] {
  const line = runOn(points, RUN_ON)
  const shape = (fill: boolean) => footprint(line, floor, [floor, floor], [half, half], [half, half], [half + BANK_OUT, half + BANK_OUT], fill)
  return level ? [shape(true), shape(false)] : [shape(true)]
}
