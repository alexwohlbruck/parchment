/**
 * 3D landmarks: hand-made models that replace a building's extrusion.
 *
 * Barrelman serves them as a vector tile layer of placements (`/tiles/
 * landmarks`) — a point per landmark, with the model's file name, its bearing
 * and scale, and the OSM refs of every building and building part it stands in
 * for. The models themselves are content-addressed GLBs under the same path.
 *
 * Replacing a building is two halves that have to land together: the model
 * appears and the extrusion goes. `LandmarkLayer` reports which refs it is
 * drawing a model for, and `withoutReplaced` turns that into a filter on the
 * building layers — only once the model is actually ready, so a slow download
 * shows the plain building rather than a hole.
 *
 * Everything here is engine-neutral, like the object specs beside it; the GL
 * lives in `landmark-layer.ts`.
 */

/**
 * Multiplied into a landmark's own colours, per flavor. A landmark keeps its
 * materials, so unlike the trees it cannot be repainted by role; at night it
 * is dimmed and cooled toward the dark map's blue instead.
 */
export const LANDMARK_TINT: Record<'light' | 'dark', [number, number, number]> = {
  light: [1, 1, 1],
  // Toward the dark map's blue, but not so far that copper stops reading as
  // copper — the buildings around it are lit, and a landmark dimmer than
  // them looks like a hole.
  dark: [0.56, 0.62, 0.76],
}

/** One placement, in the units the layer wants. */
export type Landmark = {
  id: string
  name: string
  /** Content-addressed model file name, e.g. `eiffel-tower.e33ae5cc890d.glb`. */
  model: string
  lng: number
  lat: number
  /** Degrees clockwise from north that the model's north is turned to. */
  bearing: number
  scale: number
  /** Metres above the ground the model's origin sits. */
  elevation: number
  minzoom: number
  /** OSM refs, `way/123`. */
  replaces: string[]
  /** A credit the map must show while drawing the model, when its licence asks. */
  attribution: string | null
}

const MODEL_RE = /^[a-z0-9]+(-[a-z0-9]+)*\.[0-9a-f]{12}\.glb$/
const OSM_REF_RE = /^(node|way|relation)\/\d+$/

const num = (value: unknown, fallback: number) => {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

/**
 * Read a placement off a tile feature, or null if it is not one we can draw.
 * The model name is checked here because it becomes part of a URL.
 */
export function parseLandmark(feature: any): Landmark | null {
  const p = feature?.properties ?? {}
  const coords = feature?.geometry?.coordinates
  if (!coords || typeof coords[0] !== 'number') return null
  if (typeof p.id !== 'string' || !MODEL_RE.test(p.model ?? '')) return null
  return {
    id: p.id,
    name: String(p.name ?? p.id),
    model: p.model,
    lng: coords[0],
    lat: coords[1],
    bearing: num(p.bearing, 0),
    scale: num(p.scale, 1),
    elevation: num(p.elevation, 0),
    minzoom: num(p.minzoom, 14),
    // MVT has no arrays, so the refs arrive space-separated.
    replaces: String(p.replaces ?? '').split(/\s+/).filter(ref => OSM_REF_RE.test(ref)),
    attribution: typeof p.attribution === 'string' && p.attribution.trim() ? p.attribution.trim() : null,
  }
}

/**
 * A legacy filter as an expression, for the two forms the building layers
 * use. A style filter is either all-legacy or all-expression, so the one we
 * extend has to be converted before an expression can be added beside it.
 */
function asExpression(filter: any): any {
  if (!Array.isArray(filter)) return true
  if (filter[0] === '!has' && typeof filter[1] === 'string') return ['!', ['has', filter[1]]]
  if (filter[0] === 'has' && typeof filter[1] === 'string' && filter.length === 2) return ['has', filter[1]]
  return filter
}

/**
 * A building layer's filter with the replaced buildings taken out.
 *
 * The two building sources are filtered differently, because only one of
 * them can be trusted with an id:
 *
 *   buildings_3d  Barrelman's, one feature per OSM element with the ref as
 *                 `id`. The catalog's `replaces` matches it exactly.
 *   building      The basemap's. Its feature ids are not OSM ids to rely on:
 *                 Planetiler merges every building of one height in a z14
 *                 tile into a single multipolygon under one member's id, so
 *                 an id derived from a ref can stand for a whole district.
 *                 Only ids found by footprint (`featureIds`) are filtered —
 *                 ones whose every loaded piece lies inside a landmark.
 *
 * `base` is the layer's filter as the style defined it, so repeated calls do
 * not stack.
 */
export function withoutReplaced(base: any, sourceLayer: string, refs: string[], featureIds: number[] = []): any {
  const exclude = sourceLayer === 'building'
    ? featureIds.length ? ['!', ['in', ['id'], ['literal', featureIds]]] : null
    : refs.length ? ['!', ['in', ['get', 'id'], ['literal', refs]]] : null
  if (!exclude) return base ?? null
  return base ? ['all', asExpression(base), exclude] : exclude
}

/** A model's plan extent, in its own metres: glTF x east, z south. */
export type Footprint = { minX: number; maxX: number; minZ: number; maxZ: number }

/** How far outside the model's footprint a building may reach and still be inside it. */
const FOOTPRINT_TOLERANCE_M = 1.5

/**
 * Whether a building lies wholly inside a landmark model's footprint, and so
 * is part of what the model stands in for.
 *
 * The fallback for when ids don't match, which on this basemap is often:
 * Planetiler's building ids are not reliably the OSM id, so a building that
 * `replaces` names correctly can still arrive under an unrelated number — the
 * Washington Square Arch comes through as 33574370, which as an OSM ref is a
 * building on Jones Street. Mapbox hides buildings by footprint for the same
 * reason. Requiring the *whole* building to be inside is what keeps it safe:
 * the star-shaped fort under the Statue of Liberty reaches well past her
 * pedestal, so it stays, while the pedestal's own blocks go.
 */
export function insideFootprint(
  landmark: Pick<Landmark, 'lng' | 'lat' | 'bearing' | 'scale'>,
  footprint: Footprint,
  rings: number[][][],
): boolean {
  const k = Math.cos((landmark.lat * Math.PI) / 180) * 111320
  const b = (landmark.bearing * Math.PI) / 180
  const [c, s] = [Math.cos(b), Math.sin(b)]
  const tol = FOOTPRINT_TOLERANCE_M / landmark.scale
  let any = false
  for (const ring of rings)
    for (const [lng, lat] of ring) {
      const east = (lng - landmark.lng) * k
      const south = -(lat - landmark.lat) * 110574
      // Undo `localMatrix`'s turn and scale: map (east, south) → model (x, z).
      const x = (c * east + s * south) / landmark.scale
      const z = (-s * east + c * south) / landmark.scale
      if (x < footprint.minX - tol || x > footprint.maxX + tol || z < footprint.minZ - tol || z > footprint.maxZ + tol)
        return false
      any = true
    }
  return any
}

/** Samples per side of the grid the ground under a landmark is read on. */
export const GROUND_GRID = 7

/**
 * Points to read the terrain at under a placed footprint: a GROUND_GRID ×
 * GROUND_GRID grid over its plan extent, row by row from minZ to maxZ and
 * minX to maxX within a row — the order the vertex shader indexes them in.
 */
export function groundGrid(
  landmark: Pick<Landmark, 'lng' | 'lat' | 'bearing' | 'scale'>,
  footprint: Footprint,
): [number, number][] {
  const k = Math.cos((landmark.lat * Math.PI) / 180) * 111320
  const b = (landmark.bearing * Math.PI) / 180
  const [c, s] = [Math.cos(b), Math.sin(b)]
  const { minX, maxX, minZ, maxZ } = footprint
  const n = GROUND_GRID - 1
  const points: [number, number][] = []
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++) {
      const x = minX + ((maxX - minX) * i) / n
      const z = minZ + ((maxZ - minZ) * j) / n
      // The inverse of `insideFootprint`'s turn: model (x, z) → map (east, south).
      const east = landmark.scale * (c * x - s * z)
      const south = landmark.scale * (s * x + c * z)
      points.push([landmark.lng + east / k, landmark.lat - south / 110574])
    }
  return points
}

/** A polygon or multipolygon's rings, flattened. */
export function polygonRings(geometry: any): number[][][] {
  if (geometry?.type === 'Polygon') return geometry.coordinates
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates.flat()
  return []
}
