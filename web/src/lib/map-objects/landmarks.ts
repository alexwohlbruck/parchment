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
  dark: [0.36, 0.4, 0.5],
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
const OSM_REF_RE = /^(node|way|relation)\/(\d+)$/

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
 * The basemap's feature ids for a set of OSM refs.
 *
 * Planetiler writes `osm_id * 10 + type`, and Parchment reads 1/2/3 as
 * node/way/relation elsewhere (`parsePlanetilerOsmId`). Its building layer does
 * not always follow that: the Las Vegas Eiffel Tower, way 27831699, arrives as
 * 278316990 while the Arc de Triomphe next to it is 1146970742, and the
 * terraces around the Statue of Liberty — relations 3079001 and on — arrive
 * as 30790010. So `0` is matched beside each type's own digit rather than
 * guessing which one a given build used: a stray id in a filter costs
 * nothing, a missed one leaves a building standing inside the model.
 */
export function basemapIds(refs: Iterable<string>): number[] {
  const ids: number[] = []
  for (const ref of refs) {
    const m = OSM_REF_RE.exec(ref)
    if (!m) continue
    const base = Number(m[2]) * 10
    const digit = m[1] === 'node' ? 1 : m[1] === 'way' ? 2 : 3
    ids.push(base + digit, base)
  }
  return ids
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
 * Keyed by source-layer, because the two building sources name a building
 * differently: Barrelman's `buildings_3d` carries the ref itself as `id`, the
 * basemap's `building` only has its numeric feature id. `base` is the layer's
 * filter as the style defined it, so repeated calls do not stack.
 */
export function withoutReplaced(base: any, sourceLayer: string, refs: string[]): any {
  if (!refs.length) return base ?? null
  const exclude = sourceLayer === 'building'
    ? ['!', ['in', ['id'], ['literal', basemapIds(refs)]]]
    : ['!', ['in', ['get', 'id'], ['literal', refs]]]
  return base ? ['all', asExpression(base), exclude] : exclude
}
