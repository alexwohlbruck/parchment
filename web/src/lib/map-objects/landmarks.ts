/**
 * 3D landmarks: hand-made models that replace a building's extrusion.
 *
 * Barrelman serves them as a vector tile layer of placements (`/tiles/
 * landmarks`) — a point per landmark, with the model's file name, its bearing
 * and scale, and the OSM refs of every building and building part it stands in
 * for. The models themselves are content-addressed GLBs under the same path.
 * Optionally a second, finer model (`detail`, from `detailzoom` up) and the
 * doorways to light at night (`entrances`).
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
import { BUILDING_3D_TILES, COASTER_TRACK_TILES } from '@/lib/map-style/detail-layers'
import { coveredNear, type Coverage } from './landmark-coverage'
import { FACADE_FLAVOR, type FacadeFlavor } from '@/lib/map/facade-shader'
import { hsl } from '@/lib/map-decks/palette'
import lightTokens from '@/lib/map-style/tokens.light.json'
import darkTokens from '@/lib/map-style/tokens.dark.json'

/** A landmark with windows stands among the extrusions; anything else (a ride, a bridge, a statue) keeps more of its own paint. */
export type LandmarkKind = 'building' | 'other'

/** How a landmark joins one flavor of the map. */
export type LandmarkFlavor = {
  /** The extrusions' colours (sRGB); each landmark is pulled toward one, picked by its seed. */
  palette: [number, number, number][]
  /** How far, by kind: 0 keeps the model's colours, 1 repaints it in the palette at its own lightness. */
  harmony: Record<LandmarkKind, number>
  /** The palette's share a black material keeps once pulled; white keeps 0.95, so materials keep their pattern. */
  harmonyFloor: number
  /** How far a model's own colours are lifted toward white first, by kind, so a dark model sits at its neighbours' value. */
  lift: Record<LandmarkKind, number>
  /** Window glass and lit windows, shared with the extrusions; `night` also lights the doors. */
  facade: FacadeFlavor
}

export const LANDMARK_FLAVOR: Record<'light' | 'dark', LandmarkFlavor> = {
  // Lifted toward its neighbours' lightness and a little way into their colour, so a landmark keeps its own hue.
  light: {
    palette: [hsl(lightTokens.building_3d_fill_extrusion_color)],
    harmony: { building: 0.2, other: 0.08 }, harmonyFloor: 0.78, lift: { building: 0.35, other: 0.1 },
    facade: FACADE_FLAVOR.light,
  },
  // Well into the night map's blue, or a stone tower glows among its neighbours, but with its own hue still showing.
  dark: {
    palette: [hsl(darkTokens.building_3d_fill_extrusion_color)],
    harmony: { building: 0.5, other: 0.55 }, harmonyFloor: 0.35, lift: { building: 0, other: 0 },
    facade: FACADE_FLAVOR.dark,
  },
}

/** The palette colour a landmark with this 0-1 seed is pulled toward. */
export const paletteFor = (flavor: LandmarkFlavor, seed: number) =>
  flavor.palette[Math.min(flavor.palette.length - 1, Math.floor(seed * flavor.palette.length))]

/** sRGB hex to 0–1 channels. */
const hex = (h: string): [number, number, number] =>
  [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number]

/**
 * Doors glow at night, as Open Landmarks lights them (`rendering/lighting.js`
 * there): its models carry no emissive of their own, only material names.
 */
const ENTRANCE_LIGHT = { glow: hex('#fff0cd'), intensity: 2.4 }

/** A lamp's light, a warm white; a lamp is drawn as this colour, unshaded, at night only. */
const LAMP_LIGHT = { glow: hex('#ffe7c4'), intensity: 1 }

/**
 * Floodlit stone at night (a model's `_FLOODLIGHT`): its own colour under a
 * warm white, mixed in by up to `strength`; a face turned up takes `roof` of
 * it, and one turned away from the lights `relief` less.
 */
export const FLOODLIGHT = { color: hex('#f2d9b8'), strength: 0.75, roof: 0.5, relief: 0.35 }

/** The soft light pooled in front of a lit door; drawn at night only. */
export const ENTRANCE_GLOW = { color: hex('#ffd9a0'), opacity: 0.45 }

/**
 * Whether a material is window glass, which takes the procedural facade. By
 * prefix, because a GLB cannot repeat a material name: a model with two window
 * colours names them `window` and `window-2`. Self-supporting `glass` is not a
 * window, as in Open Landmarks.
 */
export const isWindow = (material: string) => material.startsWith('window')

/** Whether a material is a lamp, which glows at night: `lamp`, `lamp-2`, as windows are named. */
export const isLamp = (material: string) => material.startsWith('lamp')

/** Whether a material is a lit sign, drawn in its own colour by day and glowing in it at night: `neon-coke-red`. */
export const isNeon = (material: string) => material.startsWith('neon')

/**
 * A lit sign at night: its own linear colour raised, as the landmarks repo's
 * renderer draws it (`neonGlow` in tools/render.ts), dimmed to `edge` seen edge-on.
 */
export const NEON_GLOW = { gain: 1.3, lift: 0.04, edge: 0.7 }

/** Whether a material is a wire (a suspender, a stay), thinned out where it is finer than a pixel. */
export const isWire = (material: string) => material.startsWith('wire')

/** Whether a wire is one of a fan's in-between ones (`wire-steel-fine`), left out where the fan is too fine to tell them apart. */
export const isFineWire = (material: string) => isWire(material) && material.endsWith('-fine')

/** How the draw shader treats a material, beyond its colour and emission. */
export const ROLE = { plain: 0, window: 1, lamp: 2, wire: 3, fineWire: 4, neon: 5 } as const

export const materialRole = (material: string): number =>
  isWindow(material) ? ROLE.window
    : isLamp(material) ? ROLE.lamp
      : isNeon(material) ? ROLE.neon
        : isFineWire(material) ? ROLE.fineWire
          : isWire(material) ? ROLE.wire
            : ROLE.plain

/** What a material emits (sRGB glow and an intensity, added in linear light), or null. */
export function materialEmission(
  material: string,
  night: boolean,
): { glow: [number, number, number]; intensity: number } | null {
  if (!night) return null
  if (material === 'entrance') return ENTRANCE_LIGHT
  return isLamp(material) ? LAMP_LIGHT : null
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
  /**
   * Metres the model is raised (positive) or sunk (negative) from where the
   * layer grounds it: for a plinth or pier the map doesn't draw, or a field
   * below the street. Sent beside the model rather than baked into it, so
   * its own ground stays at y = 0. 0 for almost every landmark.
   */
  elevation: number
  minzoom: number
  /**
   * A finer model of the same landmark, drawn from `zoom` up once it has
   * loaded. Same frame and bounds as `model`, which stays the one the
   * footprint and the ground are worked out from.
   */
  detail: { model: string; zoom: number } | null
  /** Lit doorways, in model axes and metres; glows drawn there at night. */
  entrances: [number, number, number][]
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

/** More than any real building has doors; the layer draws them in one call. */
export const MAX_ENTRANCES = 32

/**
 * Entrance points from their tile property. MVT has no arrays, so they arrive
 * as JSON; a malformed point is dropped rather than the landmark, since the
 * glow is decoration.
 */
function parseEntrances(value: unknown): [number, number, number][] {
  if (typeof value !== 'string' || !value) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter((p): p is [number, number, number] =>
      Array.isArray(p) && p.length === 3 && p.every(c => typeof c === 'number' && Number.isFinite(c)))
    .slice(0, MAX_ENTRANCES)
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
    // Both or neither: a detail model with no zoom has no point to switch at.
    detail: MODEL_RE.test(p.detail ?? '') && Number.isFinite(Number(p.detailzoom ?? NaN))
      ? { model: p.detail, zoom: Number(p.detailzoom) }
      : null,
    entrances: parseEntrances(p.entrances),
    // MVT has no arrays, so the refs arrive space-separated.
    replaces: String(p.replaces ?? '').split(/\s+/).filter(ref => OSM_REF_RE.test(ref)),
    attribution: typeof p.attribution === 'string' && p.attribution.trim() ? p.attribution.trim() : null,
  }
}

/**
 * The source-layers a landmark can take features out of, by `replaces`.
 *
 * The buildings, and the coaster tracks: a coaster model draws its own track,
 * so the flat line under it has to go too or it shows through the gaps
 * between the supports. Tracks are matched by ref only, like `buildings_3d`,
 * and never by footprint (`buildingSources` in the strategy leaves them out).
 * Coasters cross and run alongside one another, and a smaller ride's track
 * lying under a big coaster's would vanish with no model drawn for it.
 */
export const REPLACEABLE_SOURCE_LAYERS: readonly string[] = ['building', BUILDING_3D_TILES, COASTER_TRACK_TILES]

/** The feature state a replaced building or track carries. */
export const REPLACED_STATE = 'replaced'

/** The feature state of a building a floor plan is showing the inside of. */
export const INSIDE_STATE = 'inside'

const REPLACED = ['any', ['boolean', ['feature-state', REPLACED_STATE], false], ['boolean', ['feature-state', INSIDE_STATE], false]]

/**
 * The paint property that takes a replaced feature out of each layer type, the
 * value that does it, and the property's default. By feature state and not by
 * filter, which would have MapLibre lay out every tile of the source again
 * each time a landmark arrived. A negative extrusion height is dropped in the
 * fork's vertex shaders.
 */
const HIDING: Record<string, [property: string, hidden: number, shown: number]> = {
  'fill-extrusion': ['fill-extrusion-height', -1, 0],
  fill: ['fill-opacity', 0, 1],
  line: ['line-width', 0, 1],
}

const ZOOM_CURVES = ['interpolate', 'interpolate-hcl', 'interpolate-lab', 'step']

const readsReplaced = (value: unknown) => JSON.stringify(value ?? null).includes(`"feature-state","${REPLACED_STATE}"`)

/**
 * A paint value that gives `hidden` for a replaced feature. A zoom curve
 * keeps the top of the expression, as the style spec requires, and each of
 * its outputs is wrapped instead.
 */
export function unlessReplaced(value: any, hidden: number): any {
  if (readsReplaced(value)) return value
  const wrap = (v: any) => ['case', REPLACED, hidden, v]
  if (value && !Array.isArray(value) && typeof value === 'object' && Array.isArray(value.stops))
    return ['interpolate', ['exponential', value.base ?? 1], ['zoom'], ...value.stops.flatMap(([zoom, v]: [number, any]) => [zoom, wrap(v)])]
  if (Array.isArray(value) && ZOOM_CURVES.includes(value[0])) {
    const input = value[0] === 'step' ? 1 : 2
    if (JSON.stringify(value[input]) === '["zoom"]') return value.map((v, i) => (i > input && (i - input) % 2 === (value[0] === 'step' ? 1 : 0) ? wrap(v) : v))
  }
  return wrap(value)
}

/**
 * A style layer that leaves out whatever a landmark has replaced, if it draws
 * a replaceable source-layer. All of them, the roof-colour twin included,
 * since it shares the extrusion's bucket and so its heights.
 */
export function hidingReplaced<T extends { type: string; 'source-layer'?: string; paint?: any }>(layer: T): T {
  const hiding = HIDING[layer.type]
  if (!hiding || !REPLACEABLE_SOURCE_LAYERS.includes(layer['source-layer'] ?? '')) return layer
  const [property, hidden, shown] = hiding
  return { ...layer, paint: { ...layer.paint, [property]: unlessReplaced(layer.paint?.[property] ?? shown, hidden) } }
}

/**
 * The value for a replaceable layer's hiding property, set after the style
 * was built, that still hides what is replaced.
 */
export function replaceablePaint(type: string, property: string, value: any): any {
  const hiding = HIDING[type]
  return hiding?.[0] === property ? unlessReplaced(value, hiding[1]) : value
}

/**
 * The ids to mark replaced in a source-layer. The two building sources go
 * differently, because only one of them can be trusted with an id:
 *
 *   buildings_3d  Barrelman's, one feature per OSM element with the ref as
 *                 `id`, promoted to the feature's id. The catalog's
 *                 `replaces` matches it exactly.
 *   coaster_tracks  Barrelman's too, with the same `id`.
 *   building      The basemap's. Its feature ids are not OSM ids to rely on:
 *                 Planetiler merges every building of one height in a z14
 *                 tile into a single multipolygon under one member's id, so
 *                 an id derived from a ref can stand for a whole district.
 *                 Only ids found by footprint (`featureIds`) are marked —
 *                 ones whose every loaded piece lies inside a landmark.
 */
export function replacedIds(sourceLayer: string, refs: string[], featureIds: number[] = []): Array<string | number> {
  return sourceLayer === 'building' ? featureIds : refs
}

/** A model's plan extent, in its own metres: glTF x east, z south. */
export type Footprint = { minX: number; maxX: number; minZ: number; maxZ: number }

/**
 * How far outside what the model covers a building may reach and still be
 * inside it: a wall drawn a little off the OSM outline. About one cell of
 * the coverage grid.
 */
const FOOTPRINT_TOLERANCE_M = 1.5

/**
 * Whether a building lies wholly on what a landmark model covers in plan, and
 * so is part of what the model stands in for.
 *
 * The fallback for when ids don't match, which on this basemap is often:
 * Planetiler's building ids are not reliably the OSM id, so a building that
 * `replaces` names correctly can still arrive under an unrelated number — the
 * Washington Square Arch comes through as 33574370, which as an OSM ref is a
 * building on Jones Street. Mapbox hides buildings by footprint for the same
 * reason. Requiring the *whole* building to be covered is what keeps it safe:
 * the star-shaped fort under the Statue of Liberty reaches well past her
 * pedestal, so it stays, while the pedestal's own blocks go.
 *
 * Covered, not inside the model's bounding box: a coaster's box is hundreds
 * of metres of mostly open ground, and every building standing in it went —
 * see `landmark-coverage.ts`. The whole outline is walked, edges included, so
 * a building whose corners happen to land on a coaster's track with open
 * ground between them stays too.
 */
export function insideFootprint(
  landmark: Pick<Landmark, 'lng' | 'lat' | 'bearing' | 'scale'>,
  coverage: Coverage,
  rings: number[][][],
): boolean {
  const k = Math.cos((landmark.lat * Math.PI) / 180) * 111320
  const b = (landmark.bearing * Math.PI) / 180
  const [c, s] = [Math.cos(b), Math.sin(b)]
  const tol = FOOTPRINT_TOLERANCE_M / landmark.scale
  let any = false
  for (const ring of rings) {
    let last: [number, number] | null = null
    for (const [lng, lat] of ring) {
      const east = (lng - landmark.lng) * k
      const south = -(lat - landmark.lat) * 110574
      // Undo `localMatrix`'s turn and scale: map (east, south) → model (x, z).
      const x = (c * east + s * south) / landmark.scale
      const z = (-s * east + c * south) / landmark.scale
      // The first vertex is tested before any edge, so most buildings are
      // ruled out by a single lookup.
      if (!coveredNear(coverage, x, z, tol)) return false
      if (last) {
        const [lx, lz] = last
        const steps = Math.floor(Math.hypot(x - lx, z - lz) / coverage.cell)
        for (let i = 1; i <= steps; i++) {
          const f = i / (steps + 1)
          if (!coveredNear(coverage, lx + (x - lx) * f, lz + (z - lz) * f, tol)) return false
        }
      }
      last = [x, z]
      any = true
    }
  }
  return any
}

/** Samples per side of the grid the ground under a landmark is read on. */
export const GROUND_GRID = 7

/**
 * Where a point in a placed model's plan lands on the map: model (x, z) in its
 * own units, turned and scaled as `localMatrix` does, to lng/lat. The inverse
 * of `insideFootprint`'s turn.
 */
export function modelToLngLat(
  landmark: Pick<Landmark, 'lng' | 'lat' | 'bearing' | 'scale'>,
  x: number,
  z: number,
): [number, number] {
  const k = Math.cos((landmark.lat * Math.PI) / 180) * 111320
  const b = (landmark.bearing * Math.PI) / 180
  const east = landmark.scale * (Math.cos(b) * x - Math.sin(b) * z)
  const south = landmark.scale * (Math.sin(b) * x + Math.cos(b) * z)
  return [landmark.lng + east / k, landmark.lat - south / 110574]
}

/**
 * Points to read the terrain at under a placed footprint: a GROUND_GRID ×
 * GROUND_GRID grid over its plan extent, row by row from minZ to maxZ and
 * minX to maxX within a row — the order the vertex shader indexes them in.
 */
export function groundGrid(
  landmark: Pick<Landmark, 'lng' | 'lat' | 'bearing' | 'scale'>,
  footprint: Footprint,
): [number, number][] {
  const { minX, maxX, minZ, maxZ } = footprint
  const n = GROUND_GRID - 1
  const points: [number, number][] = []
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++)
      points.push(modelToLngLat(landmark, minX + ((maxX - minX) * i) / n, minZ + ((maxZ - minZ) * j) / n))
  return points
}

/** A polygon or multipolygon's rings, flattened. */
export function polygonRings(geometry: any): number[][][] {
  if (geometry?.type === 'Polygon') return geometry.coordinates
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates.flat()
  return []
}
