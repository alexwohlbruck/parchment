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

function pointInRing([x, y]: [number, number], ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Inside the outer ring and outside every hole. */
function contains(point: [number, number], { rings }: BuildingFootprint): boolean {
  if (!rings.length || !pointInRing(point, rings[0])) return false
  return !rings.slice(1).some(hole => pointInRing(point, hole))
}

/** Index footprints by the grid cells their bounding boxes touch. */
export function footprintIndex(buildings: BuildingFootprint[]) {
  const cells = new Map<string, BuildingFootprint[]>()
  for (const b of buildings) {
    const outer = b.rings[0]
    if (!outer?.length) continue
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity]
    for (const [x, y] of outer) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y)
    }
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
      for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) {
        const key = `${cx}:${cy}`
        const list = cells.get(key)
        if (list) list.push(b)
        else cells.set(key, [b])
      }
  }
  return (point: [number, number]) =>
    cells.get(`${Math.floor(point[0] / CELL)}:${Math.floor(point[1] / CELL)}`) ?? []
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
