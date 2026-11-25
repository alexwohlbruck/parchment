/**
 * Heights for POI dots, so a shop on a tower's roof is drawn on the roof and
 * not at the foot of the wall.
 *
 * The symbol layer can lift a dot (`symbol-height-offset`), but only by what
 * the POI's own tile properties say, and a POI does not know which building it
 * is in. So the two are joined here: point-in-polygon against the extruded
 * buildings, on a coarse grid so a few thousand of each stay cheap.
 */

/** Metres per storey, for a POI that says which level it is on. */
export const LEVEL_HEIGHT = 3.2

/** How far above a surface a dot floats, so it never sinks into a roof. */
const CLEARANCE = 0.5

export type Ring = Array<[number, number]>
export type BuildingFootprint = { rings: Ring[]; height: number }

const CELL = 0.0005

function pointInRing(point: [number, number], ring: Ring): boolean {
  const x = point[0]
  const y = point[1]
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1]
    const xj = ring[j][0], yj = ring[j][1]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Inside the outer ring and outside every hole. */
function contains(point: [number, number], { rings }: BuildingFootprint): boolean {
  if (!rings.length || !pointInRing(point, rings[0])) return false
  for (let i = 1; i < rings.length; i++) if (pointInRing(point, rings[i])) return false
  return true
}

/** One number per grid cell: rows stay within ±180,000, so columns a million apart never collide. */
const cellKey = (cx: number, cy: number) => cx * 1e6 + cy

/** Index footprints by the grid cells their bounding boxes touch. */
export function footprintIndex(buildings: BuildingFootprint[]) {
  const cells = new Map<number, BuildingFootprint[]>()
  for (const b of buildings) {
    const outer = b.rings[0]
    if (!outer?.length) continue
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (let i = 0; i < outer.length; i++) {
      const x = outer[i][0], y = outer[i][1]
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
      for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) {
        const key = cellKey(cx, cy)
        const list = cells.get(key)
        if (list) list.push(b)
        else cells.set(key, [b])
      }
  }
  const none: BuildingFootprint[] = []
  return (point: [number, number]) => cells.get(cellKey(Math.floor(point[0] / CELL), Math.floor(point[1] / CELL))) ?? none
}

/**
 * Metres above the ground to draw a POI at.
 *
 * A level tag wins, since it is the POI's own claim — capped at the roof of the
 * building it stands in, and kept at the ground when it is below it. Without
 * one, a POI inside a building sits on the roof of the tallest part covering
 * it; outside every building it stays on the ground.
 */
export function poiElevation(
  point: [number, number],
  level: unknown,
  near: (point: [number, number]) => BuildingFootprint[],
): number {
  let roof = 0
  for (const b of near(point)) if (b.height > roof && contains(point, b)) roof = b.height
  // Outside every building there is nothing to stand on, whatever level it claims.
  if (!roof) return 0
  const storey = typeof level === 'number' ? level : parseFloat(String(level))
  if (Number.isFinite(storey)) {
    if (storey <= 0) return 0
    return Math.min(storey * LEVEL_HEIGHT + CLEARANCE, roof + CLEARANCE)
  }
  return roof + CLEARANCE
}

type Raised = { id?: string | number; properties: { _elev: number } }

/**
 * What to change in a source showing `shown` (each id's height) so it shows
 * `features`: the ids gone, and the features new or moved to another height.
 * `onlyNew` adds the ids not shown and changes nothing else. Null where the
 * features cannot be told apart by id, and the whole collection has to be
 * written instead.
 */
export function raisedDiff<T extends Raised>(
  shown: Map<string | number, number>,
  features: T[],
  onlyNew = false,
): { remove: Array<string | number>; add: T[] } | null {
  const next = new Set<string | number>()
  for (const f of features) {
    if (f.id === undefined || f.id === null || next.has(f.id)) return null
    next.add(f.id)
  }
  return {
    remove: onlyNew ? [] : [...shown.keys()].filter(id => !next.has(id)),
    add: features.filter(f => (onlyNew ? !shown.has(f.id!) : shown.get(f.id!) !== f.properties._elev)),
  }
}
