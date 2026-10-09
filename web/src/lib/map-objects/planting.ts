/**
 * Planting areas with objects: a jittered grid anchored to the world, clipped
 * to each tile piece, kept off the roads, paths, buildings, water and open
 * ground the basemap draws. Forests, scrub, flower beds and solar arrays are
 * all this, at their own spacing.
 *
 * Anchored to the world rather than to a tile, so an area is planted the same
 * on every load and has no seams; each tile piece plants only inside its own
 * tile, so an area split across tiles is never planted twice.
 */
import { SOURCE as BASEMAP_SOURCE } from '@/lib/map-style/build'
import { DETAIL_SOURCE, OBJECT_AREA_TILES, PARKING_TILES, PITCH_TILES } from '@/lib/map-style/detail-layers'
import type { ObjectInstance, ObjectSourceSpec } from './object-layer'

/** One mercator metre: a metre of ground at the equator, about 0.8 m at US latitudes. */
export const MERCATOR_METRE = 1 / 40075016.686

/** Clearance either side of a way's centreline, in mercator metres, by class. */
const CLEARANCE: Record<string, number> = {
  motorway: 16, trunk: 13, primary: 12, secondary: 10, tertiary: 9,
  minor: 7, service: 6, track: 4, path: 3, rail: 6, transit: 6,
}
const DEFAULT_CLEARANCE = 5

/** Landuse classes that are open ground, not woodland, wherever they overlap it. */
const OPEN_LANDUSE = new Set(['pitch', 'stadium', 'playground', 'track', 'parking', 'cemetery'])

type Point = [number, number]
type Ring = Point[]
type Span = [number, number]

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number }

export type ForestExclusions = {
  /** Polygons trees may not stand in, in mercator units, bucketed by grid cell. */
  areas: Map<number, Ring[][]>
  /** Way segments as [x0, y0, x1, y1, clearance] in mercator units, bucketed by grid cell. */
  segments: Map<number, number[][]>
  cell: number
}

const mercX = (lng: number) => (lng + 180) / 360
const mercY = (lat: number) => {
  const s = Math.sin((lat * Math.PI) / 180)
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)
}
const lngOf = (x: number) => x * 360 - 180
const latOf = (y: number) => (360 / Math.PI) * Math.atan(Math.exp((1 - 2 * y) * Math.PI)) - 90

/** A geometry's polygons as mercator rings; anything else gives none. */
export function polygonsOf(geometry: any): Ring[][] {
  const polys =
    geometry?.type === 'Polygon' ? [geometry.coordinates]
    : geometry?.type === 'MultiPolygon' ? geometry.coordinates
    : []
  return polys.map((rings: number[][][]) =>
    rings.map(ring => ring.map(([lng, lat]) => [mercX(lng), mercY(lat)] as Point)),
  )
}

/** Where a horizontal line crosses a polygon's rings, as even-odd inside spans. */
export function spansAt(rings: Ring[], y: number): Span[] {
  const xs: number[] = []
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x0, y0] = ring[j]
      const [x1, y1] = ring[i]
      if ((y0 > y) !== (y1 > y)) xs.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0))
    }
  xs.sort((a, b) => a - b)
  const spans: Span[] = []
  for (let i = 0; i + 1 < xs.length; i += 2) spans.push([xs[i], xs[i + 1]])
  return spans
}

const within = (spans: Span[], x: number) => spans.some(([a, b]) => x >= a && x < b)

function inside(rings: Ring[], x: number, y: number): boolean {
  let hit = false
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x0, y0] = ring[j]
      const [x1, y1] = ring[i]
      if ((y0 > y) !== (y1 > y) && x < x0 + ((y - y0) / (y1 - y0)) * (x1 - x0)) hit = !hit
    }
  return hit
}

const cellKey = (i: number, j: number) => i * 73856093 ^ j * 19349663

function bucket<T>(index: Map<number, T[]>, i: number, j: number, item: T) {
  const key = cellKey(i, j)
  const list = index.get(key)
  if (list) list.push(item)
  else index.set(key, [item])
}

/** A small integer hash of a grid cell, 0-1, decorrelated by `salt`. */
export function cellHash(i: number, j: number, salt: number): number {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(salt + 1, 2246822519)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

function segmentDistanceSquared(px: number, py: number, s: number[]): number {
  const [x0, y0, x1, y1] = s
  const dx = x1 - x0
  const dy = y1 - y0
  const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / (dx * dx + dy * dy || 1)))
  const ex = x0 + t * dx - px
  const ey = y0 + t * dy - py
  return ex * ex + ey * ey
}

function nearWay(ex: ForestExclusions, x: number, y: number): boolean {
  const ci = Math.floor(x / ex.cell)
  const cj = Math.floor(y / ex.cell)
  for (let di = -1; di <= 1; di++)
    for (let dj = -1; dj <= 1; dj++) {
      const near = ex.segments.get(cellKey(ci + di, cj + dj))
      if (!near) continue
      for (const s of near) if (segmentDistanceSquared(x, y, s) < s[4] * s[4]) return true
    }
  return false
}

function inArea(ex: ForestExclusions, x: number, y: number): boolean {
  const near = ex.areas.get(cellKey(Math.floor(x / ex.cell), Math.floor(y / ex.cell)))
  return !!near && near.some(rings => inside(rings, x, y))
}

/** Where the horizontal line at `y` comes within a way's clearance (plus `pad`), as an x interval, or null. */
function wayCrossing(s: number[], y: number, pad: number): Span | null {
  const [x0, y0, x1, y1] = s
  const r = s[4] + pad
  let lo = Infinity
  let hi = -Infinity
  for (const [cx, cy] of [[x0, y0], [x1, y1]]) {
    const h = r * r - (y - cy) ** 2
    if (h < 0) continue
    lo = Math.min(lo, cx - Math.sqrt(h))
    hi = Math.max(hi, cx + Math.sqrt(h))
  }
  const [dx, dy] = [x1 - x0, y1 - y0]
  const length = Math.hypot(dx, dy)
  if (length > 0 && dy !== 0) {
    // Linear in x along the line: the projection onto the segment, and the signed distance from it.
    const bounds = [
      [dx, (y - y0) * dy, 0, length * length],
      [dy, -(y - y0) * dx, -r * length, r * length],
    ].map(([k, c, min, max]) => {
      const [a, b] = [(min - c) / k + x0, (max - c) / k + x0]
      return k > 0 ? [a, b] : k < 0 ? [b, a] : c >= min && c <= max ? [-Infinity, Infinity] : [Infinity, -Infinity]
    })
    const [a, b] = [Math.max(bounds[0][0], bounds[1][0]), Math.min(bounds[0][1], bounds[1][1])]
    if (a <= b) [lo, hi] = [Math.min(lo, a), Math.max(hi, b)]
  }
  return lo <= hi ? [lo, hi] : null
}

/**
 * Where the horizontal line at `y` between `x0` and `x1` is blocked by a way's
 * clearance or an excluded area, each widened by `pad`; sorted, may overlap.
 */
export function blockedAlong(ex: ForestExclusions, y: number, x0: number, x1: number, pad: number): Span[] {
  const blocked: Span[] = []
  const seenWays = new Set<number[]>()
  const seenAreas = new Set<Ring[]>()
  const j = Math.floor(y / ex.cell)
  for (let i = Math.floor(x0 / ex.cell) - 1; i <= Math.floor(x1 / ex.cell) + 1; i++)
    for (let dj = -1; dj <= 1; dj++) {
      for (const s of ex.segments.get(cellKey(i, j + dj)) ?? []) {
        if (seenWays.has(s)) continue
        seenWays.add(s)
        const span = wayCrossing(s, y, pad)
        if (span) blocked.push(span)
      }
      for (const rings of ex.areas.get(cellKey(i, j + dj)) ?? []) {
        if (seenAreas.has(rings)) continue
        seenAreas.add(rings)
        for (const [a, b] of spansAt(rings, y)) blocked.push([a - pad, b + pad])
      }
    }
  return blocked.sort((a, b) => a[0] - b[0])
}

/** Index the ways and open areas a forest must leave clear. */
export function buildExclusions(ways: any[], areas: any[]): ForestExclusions {
  return finish(exclusionSteps(ways, areas))
}

/** Ways and areas read between yields while indexing exclusions. */
const EXCLUSION_STEP = 64

/** `buildExclusions` a few features at a time. */
export function* exclusionSteps(ways: any[], areas: any[]): Generator<void, ForestExclusions> {
  const metre = MERCATOR_METRE
  const cell = 32 * metre
  const segments = new Map<number, number[][]>()
  let read = 0
  for (const way of ways) {
    if (++read % EXCLUSION_STEP === 0) yield
    if (way.properties?.brunnel === 'tunnel' || way.properties?.brunnel === 'bridge') continue
    const clearance = (CLEARANCE[way.properties?.class] ?? DEFAULT_CLEARANCE) * metre
    const lines =
      way.geometry?.type === 'LineString' ? [way.geometry.coordinates]
      : way.geometry?.type === 'MultiLineString' ? way.geometry.coordinates
      : []
    for (const line of lines)
      for (let k = 1; k < line.length; k++) {
        const s = [mercX(line[k - 1][0]), mercY(line[k - 1][1]), mercX(line[k][0]), mercY(line[k][1]), clearance]
        const i0 = Math.floor((Math.min(s[0], s[2]) - clearance) / cell)
        const i1 = Math.floor((Math.max(s[0], s[2]) + clearance) / cell)
        const j0 = Math.floor((Math.min(s[1], s[3]) - clearance) / cell)
        const j1 = Math.floor((Math.max(s[1], s[3]) + clearance) / cell)
        if ((i1 - i0) * (j1 - j0) > 400) continue
        for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) bucket(segments, i, j, s)
      }
  }
  const indexed = new Map<number, Ring[][]>()
  for (const rings of areas.flatMap(a => polygonsOf(a.geometry))) {
    if (++read % EXCLUSION_STEP === 0) yield
    let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity]
    for (const [x, y] of rings[0] ?? []) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x)
      minY = Math.min(minY, y); maxY = Math.max(maxY, y)
    }
    const [i0, i1, j0, j1] = [minX, maxX, minY, maxY].map(v => Math.floor(v / cell))
    if ((i1 - i0) * (j1 - j0) > 2500) continue
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) bucket(indexed, i, j, rings)
  }
  return { areas: indexed, segments, cell }
}

/** A planting grid: cell size in mercator metres along x and y, and how far a point may wander in its cell. */
export type Grid = { dx: number; dy: number; jitter: number }

/** A planted grid point: [lng, lat, i, j, interior]. */
export type PlantedPoint = [number, number, number, number, boolean]

/** Cells either way that must all be planted for a point to count as inside the area. */
const INTERIOR_REACH = 2

/**
 * Grid points inside an area and inside `bounds`, clear of every exclusion,
 * each seeded from its cell. A point is interior when every cell within
 * `INTERIOR_REACH` is planted too, so nothing but its top is ever seen.
 */
export function plant(rings: Ring[], bounds: Bounds, ex: ForestExclusions | null, grid: Grid, stride = 1): PlantedPoint[] {
  const [sx, sy] = [grid.dx * MERCATOR_METRE, grid.dy * MERCATOR_METRE]
  const slack = (1 - grid.jitter) / 2
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const [x, y] of rings[0] ?? []) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x)
    minY = Math.min(minY, y); maxY = Math.max(maxY, y)
  }
  const j0 = Math.floor(Math.max(minY, bounds.minY) / sy)
  const j1 = Math.floor(Math.min(maxY, bounds.maxY) / sy)
  const i0 = Math.floor(Math.max(minX, bounds.minX) / sx)
  const i1 = Math.floor(Math.min(maxX, bounds.maxX) / sx)
  if (i1 < i0 || j1 < j0) return []

  const point = (i: number, j: number): Point => [
    (i + slack + cellHash(i, j, 1) * grid.jitter) * sx,
    (j + slack + cellHash(i, j, 2) * grid.jitter) * sy,
  ]

  // A thinned planting is only drawn far off, where nobody sees a trunk, so it skips the interior test.
  if (stride > 1) {
    const out: PlantedPoint[] = []
    const first = (n: number) => Math.ceil(n / stride) * stride
    for (let j = first(j0); j <= j1; j += stride) {
      const spans = spansAt(rings, (j + 0.5) * sy)
      if (!spans.length) continue
      for (let i = first(i0); i <= i1; i += stride) {
        const [x, y] = point(i, j)
        if (x < bounds.minX || x >= bounds.maxX || y < bounds.minY || y >= bounds.maxY) continue
        if (within(spans, x) && !(ex && (nearWay(ex, x, y) || inArea(ex, x, y)))) out.push([lngOf(x), latOf(y), i, j, false])
      }
    }
    return out
  }

  const r = INTERIOR_REACH
  const width = i1 - i0 + 1 + 2 * r
  const clear = new Uint8Array(width * (j1 - j0 + 1 + 2 * r))
  const at = (i: number, j: number) => (j - j0 + r) * width + (i - i0 + r)
  for (let j = j0 - r; j <= j1 + r; j++) {
    const spans = spansAt(rings, (j + 0.5) * sy)
    if (!spans.length) continue
    for (let i = i0 - r; i <= i1 + r; i++) {
      const [x, y] = point(i, j)
      if (within(spans, x) && !(ex && (nearWay(ex, x, y) || inArea(ex, x, y)))) clear[at(i, j)] = 1
    }
  }

  const out: PlantedPoint[] = []
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      if (!clear[at(i, j)]) continue
      const [x, y] = point(i, j)
      if (x < bounds.minX || x >= bounds.maxX || y < bounds.minY || y >= bounds.maxY) continue
      let interior = true
      for (let dj = -r; dj <= r && interior; dj++)
        for (let di = -r; di <= r; di++)
          if (!clear[at(i + di, j + dj)]) { interior = false; break }
      out.push([lngOf(x), latOf(y), i, j, interior])
    }
  return out
}

/**
 * Where a planted object stands within its area, and how thinly the area is
 * planted there: `level` 0 is every cell, each level above keeps every other
 * cell each way; `sparse` is any thinning at all.
 */
export type PlantedPlace = { interior: boolean; sparse: boolean; level: number }

/**
 * Distance falloff: an area is planted fully while neighbouring cells land at
 * least `spacing` pixels apart on screen, and one level thinner per halving of
 * that. Levels blend over `DITHER` of a level, so there is no edge to see.
 */
const SCREEN_OBJECTS = 9000
const MIN_SPACING = 5
const DITHER = 0.7
const BLOCK_CELLS = 16
/** Levels a cell shown last gather may slip before it is thinned, so a small pan never drops a visible tree. */
const HYSTERESIS = 0.5

/** The camera in mercator units: ground position and height, focal length and the target spacing in CSS pixels. */
export type PlantingCamera = { x: number; y: number; altitude: number; focal: number; spacing: number }

/** How far apart on screen, in pixels, two cells `cell` apart appear `dx, dy` from the camera's ground point. */
export function screenSpacing(camera: PlantingCamera, dx: number, dy: number, cell: number): number {
  const distance = Math.hypot(dx, dy, camera.altitude)
  return ((camera.focal * cell) / distance) * Math.sqrt(Math.max(camera.altitude / distance, 0.05))
}

/** Continuous thinning level for cells `apart` pixels apart: 0 while wide enough, +1 per halving. */
export function falloff(apart: number, spacing: number, floor = 0): number {
  return Math.max(floor, 1 + Math.log2(spacing / Math.max(apart, 1e-12)))
}

/** How many times a cell's indices both halve evenly: the coarsest planting that keeps it. */
export function latticeLevel(i: number, j: number): number {
  let level = 0
  while (level < 16 && ((i | j) & ((1 << (level + 1)) - 1)) === 0) level++
  return level
}

/** Whether a cell keeps its object at thinning level `level`, dithered so levels blend, never below `floor`. */
export function keeps(i: number, j: number, level: number, floor = 0): boolean {
  return latticeLevel(i, j) >= Math.max(floor, Math.floor(level + (cellHash(i, j, 10) - 0.5) * DITHER))
}

/** Where the camera stands over the ground, from the map's centre, pitch, bearing and zoom. */
export function plantingCamera(map: any): PlantingCamera {
  const { lng, lat } = map.getCenter()
  const canvas = map.getCanvas?.()
  const height = canvas?.clientHeight || 800
  const width = canvas?.clientWidth || 800
  const focal = map.transform?.cameraToCenterDistance ?? 1.5 * height
  const reach = focal / (512 * 2 ** map.getZoom())
  const pitch = (map.getPitch() * Math.PI) / 180
  const bearing = (map.getBearing() * Math.PI) / 180
  const back = reach * Math.sin(pitch)
  return {
    x: mercX(lng) - back * Math.sin(bearing),
    y: mercY(lat) + back * Math.cos(bearing),
    altitude: reach * Math.cos(pitch),
    focal,
    spacing: Math.max(MIN_SPACING, Math.sqrt((width * height) / SCREEN_OBJECTS)),
  }
}

/**
 * The thinning level at `x, y`: by on-screen spacing, but full density within
 * `reach` of the centre and two levels thinner per doubling past it.
 */
export function plantingLevel(camera: PlantingCamera, center: Point, reach: number, cell: number, x: number, y: number, floor = 0): number {
  const onScreen = falloff(screenSpacing(camera, x - camera.x, y - camera.y, cell), camera.spacing)
  const near = 2 * Math.log2(Math.max(Math.hypot(x - center[0], y - center[1]), 1e-12) / reach)
  return Math.max(floor, Math.min(onScreen, near))
}

/** The tile a queried feature came from, as mercator bounds. */
export function tileBounds(feature: any): Bounds | null {
  const { _x: x, _y: y, _z: z } = feature
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return null
  const n = 2 ** z
  return { minX: x / n, minY: y / n, maxX: (x + 1) / n, maxY: (y + 1) / n }
}

/** Barrelman's detail layers that are open ground wherever they overlap a planting. */
const OPEN_DETAIL: Array<[string, (f: any) => boolean]> = [
  [OBJECT_AREA_TILES, f => f.properties?.kind === 'solar'],
  [PITCH_TILES, f => f.properties?.kind === 'surface'],
  [PARKING_TILES, () => true],
]

const querySource = (map: any, source: string, sourceLayer?: string) => {
  try {
    return map.querySourceFeatures(source, sourceLayer ? { sourceLayer } : {})
  } catch {
    return []
  }
}

/** The basemap's ways, buildings and water, as exclusions. */
export function builtExclusionsFor(map: any, basemap: string = BASEMAP_SOURCE): ForestExclusions {
  return buildExclusions(querySource(map, basemap, 'transportation'), [
    ...querySource(map, basemap, 'building'),
    ...querySource(map, basemap, 'water'),
  ])
}

function* exclusionsFor(map: any, basemap: string, detail: (sourceLayer: string) => [string, string?]): Generator<void, ForestExclusions> {
  const ways = querySource(map, basemap, 'transportation')
  yield
  const areas = [...querySource(map, basemap, 'building'), ...querySource(map, basemap, 'water')]
  yield
  areas.push(...querySource(map, basemap, 'landuse').filter((f: any) => OPEN_LANDUSE.has(f.properties?.class)))
  for (const [layer, keep] of OPEN_DETAIL) areas.push(...querySource(map, ...detail(layer)).filter(keep))
  yield
  return yield* exclusionSteps(ways, areas)
}

/** Run a generator to its end, for when there is nothing to yield to. */
function finish<T>(steps: Generator<void, T>): T {
  let next = steps.next()
  while (!next.done) next = steps.next()
  return next.value
}

/** The view in mercator units, padded a third each way, so a pan reveals trees already planted. */
function viewBounds(map: any): Bounds | null {
  const b = map.getBounds?.()
  if (!b) return null
  const [x0, x1, y0, y1] = [mercX(b.getWest()), mercX(b.getEast()), mercY(b.getNorth()), mercY(b.getSouth())]
  const pad = Math.max(x1 - x0, y1 - y0) * 0.35
  return { minX: x0 - pad, minY: y0 - pad, maxX: x1 + pad, maxY: y1 + pad }
}

export function pieceKey(feature: any): string {
  const g = feature.geometry
  const first = g?.type === 'MultiPolygon' ? g.coordinates[0]?.[0]?.[0] : g?.coordinates?.[0]?.[0]
  return `${feature._z}/${feature._x}/${feature._y}/${feature.id ?? ''}/${first}/${g?.coordinates?.length}`
}

export type PlantedSpec = ObjectSourceSpec & {
  /** The basemap source whose ways and buildings a planting keeps clear of. */
  exclusionsFrom: string
  /** Where a barrelman detail layer is read from: its source and source-layer. */
  detailFrom?: (sourceLayer: string) => [string, string?]
}

/** A piece's own bounds, so only the blocks it covers are visited. */
function extentOf(geometry: any): Bounds {
  const out = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  const polys = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : []
  for (const poly of polys)
    for (const [lng, lat] of poly[0] ?? []) {
      const [x, y] = [mercX(lng), mercY(lat)]
      if (x < out.minX) out.minX = x
      if (x > out.maxX) out.maxX = x
      if (y < out.minY) out.minY = y
      if (y > out.maxY) out.maxY = y
    }
  return out
}

const intersect = (a: Bounds, b: Bounds): Bounds => ({
  minX: Math.max(a.minX, b.minX), minY: Math.max(a.minY, b.minY), maxX: Math.min(a.maxX, b.maxX), maxY: Math.min(a.maxY, b.maxY),
})

/**
 * An object spec that plants every polygon it reads, and stands an object on
 * every point. `grid` gives a feature's spacing, or null to leave it bare;
 * `clear` whether it keeps off the ways and buildings; `instance` shapes each
 * planted object from its cell.
 *
 * With `budget`, the objects nearest the centre are kept and the rest dropped.
 * With `falloff`, an area thins with distance instead (see `plantingLevel`),
 * planted fully out to `falloff.full` objects' reach of the centre.
 */
export function plantedSpec(options: {
  source: string
  sourceLayer: string
  minzoom: number
  budget?: number
  falloff?: { full: number }
  /** Below this zoom only every other cell each way is planted. */
  sparseBelow?: number
  grid: (feature: any) => Grid | null
  clear: (feature: any) => boolean
  instance: (feature: any, lng: number, lat: number, i: number, j: number, place: PlantedPlace) => ObjectInstance | null
  /** Runs once per gather, before any feature is planted. */
  prepare?: (map: any) => void
}): PlantedSpec {
  type Shown = { points: PlantedPoint[]; levels: number[] }
  const planted = new Map<string, PlantedPoint[]>()
  const extents = new Map<string, Bounds>()
  let shown = new Map<object, Shown>()
  let wasShown = new Set<number>()
  let nowShown = new Set<number>()
  const cellId = (i: number, j: number) => i * 67108864 + j
  let strides = new Map<string, number>()
  let floor = 0
  let map: any = null
  let basemap = BASEMAP_SOURCE
  let detail: (sourceLayer: string) => [string, string?] = layer => [DETAIL_SOURCE, layer]
  let exclusions: ForestExclusions | null = null
  let view: Bounds | null = null
  let center: Point = [0, 0]
  let camera: PlantingCamera | null = null

  const cellOf = (grid: Grid) => Math.max(grid.dx, grid.dy) * MERCATOR_METRE
  const levelAt = (grid: Grid, x: number, y: number) => {
    if (!camera || !options.falloff) return floor
    const cell = cellOf(grid)
    return plantingLevel(camera, center, Math.sqrt(options.falloff.full / Math.PI) * cell, cell, x, y, floor)
  }

  /** The coarsest stride every cell of a block can be planted at: set by its points nearest the camera and the centre. */
  const strideOf = (grid: Grid, block: number, bi: number, bj: number) => {
    if (!options.falloff || !camera) return 1
    const key = `${grid.dx},${grid.dy}|${bi},${bj}`
    let stride = strides.get(key)
    if (stride !== undefined) return stride
    const nearest = ([x, y]: Point): Point => [
      Math.min(Math.max(x, bi * block), (bi + 1) * block),
      Math.min(Math.max(y, bj * block), (bj + 1) * block),
    ]
    const lowest = Math.min(levelAt(grid, ...nearest([camera.x, camera.y])), levelAt(grid, ...nearest(center)))
    stride = 2 ** Math.max(0, Math.min(Math.floor(lowest - DITHER / 2 - HYSTERESIS), Math.log2(BLOCK_CELLS)))
    strides.set(key, stride)
    return stride
  }

  /** A block already planted at a finer stride, cut down to `stride`, so a pan need not replant it. */
  const coarsened = (blockKey: string, stride: number) => {
    for (let finer = stride / 2; finer >= 1; finer /= 2) {
      const points = planted.get(`${blockKey}|${finer}`)
      if (!points) continue
      const kept = points.filter(([, , i, j]) => i % stride === 0 && j % stride === 0).map(p => [p[0], p[1], p[2], p[3], false] as PlantedPoint)
      planted.set(`${blockKey}|${stride}`, kept)
      return kept
    }
    return undefined
  }

  type Block = { key: string; stride: number; bounds: Bounds }

  /**
   * The blocks of one tile piece to plant: inside the view and the piece's own
   * extent. Under a budget, also only within the square around the centre that
   * `budget` objects at this spacing would fill; under a falloff, each block at
   * the coarsest stride its nearest cell allows.
   */
  const blocksOf = (feature: any, grid: Grid, tile: Bounds): Block[] => {
    const key = pieceKey(feature)
    let extent = extents.get(key)
    if (!extent) {
      extent = extentOf(feature.geometry)
      if (extents.size >= 20000) extents.clear()
      extents.set(key, extent)
    }
    let area = intersect(intersect(tile, extent), view ?? tile)
    if (!options.falloff && options.budget !== undefined) {
      const reach = Math.sqrt(options.budget / Math.PI) * cellOf(grid) * (floor ? 2 : 1) * 1.15
      area = intersect(area, { minX: center[0] - reach, minY: center[1] - reach, maxX: center[0] + reach, maxY: center[1] + reach })
    }
    const block = BLOCK_CELLS * grid.dx * MERCATOR_METRE
    const blocks: Block[] = []
    for (let bj = Math.floor(area.minY / block); bj * block < area.maxY; bj++)
      for (let bi = Math.floor(area.minX / block); bi * block < area.maxX; bi++)
        blocks.push({
          key: `${key}|${bi},${bj}`,
          stride: strideOf(grid, block, bi, bj),
          bounds: intersect(tile, { minX: bi * block, minY: bj * block, maxX: (bi + 1) * block, maxY: (bj + 1) * block }),
        })
    return blocks
  }

  const cached = (b: Block) => planted.get(`${b.key}|${b.stride}`) ?? coarsened(b.key, b.stride)

  function* plantSteps(feature: any, grid: Grid, b: Block, clear: boolean): Generator<void, PlantedPoint[]> {
    if (clear && !exclusions) exclusions = map ? yield* exclusionsFor(map, basemap, detail) : buildExclusions([], [])
    const planting = b.bounds.minX < b.bounds.maxX && b.bounds.minY < b.bounds.maxY
      ? polygonsOf(feature.geometry).flatMap(rings => plant(rings, b.bounds, clear ? exclusions : null, grid, b.stride))
      : []
    if (planted.size >= 20000) planted.clear()
    planted.set(`${b.key}|${b.stride}`, planting)
    return planting
  }

  const plantPiece = (feature: any, grid: Grid, tile: Bounds, clear: boolean): PlantedPoint[] => {
    const points: PlantedPoint[] = []
    for (const b of blocksOf(feature, grid, tile))
      for (const p of cached(b) ?? finish(plantSteps(feature, grid, b, clear))) points.push(p)
    return points
  }

  const shownOf = (feature: any): Shown => {
    const known = shown.get(feature)
    if (known) return known
    const out: Shown = { points: [], levels: [] }
    if (feature.geometry?.type === 'Point') {
      const [lng, lat] = feature.geometry.coordinates
      out.points.push([lng, lat, Math.round(lng * 1e6), Math.round(lat * 1e6), false])
      out.levels.push(0)
    } else {
      const grid = options.grid(feature)
      const tile = tileBounds(feature)
      if (grid && tile) {
        const [sx, sy] = [grid.dx * MERCATOR_METRE, grid.dy * MERCATOR_METRE]
        for (const p of plantPiece(feature, grid, tile, options.clear(feature))) {
          const level = levelAt(grid, (p[2] + 0.5) * sx, (p[3] + 0.5) * sy)
          const id = cellId(p[2], p[3])
          const slack = wasShown.has(id) ? HYSTERESIS : 0
          if (options.falloff ? !keeps(p[2], p[3], Math.max(floor, level - slack), floor) : latticeLevel(p[2], p[3]) < floor) continue
          nowShown.add(id)
          out.points.push(p)
          out.levels.push(level)
        }
      }
    }
    shown.set(feature, out)
    return out
  }

  return {
    source: options.source,
    sourceLayer: options.sourceLayer,
    exclusionsFrom: BASEMAP_SOURCE,
    minzoom: options.minzoom,
    distinct: false,
    followsView: true,
    budget: options.falloff ? undefined : options.budget,
    prepare(m, spec) {
      map = m
      basemap = (spec as PlantedSpec).exclusionsFrom ?? BASEMAP_SOURCE
      detail = (spec as PlantedSpec).detailFrom ?? (layer => [DETAIL_SOURCE, layer])
      exclusions = null
      shown = new Map()
      strides = new Map()
      // A gather abandoned for a newer one leaves a partial set; keep the last full one instead.
      if (nowShown.size >= wasShown.size / 2) wasShown = nowShown
      nowShown = new Set()
      floor = m.getZoom() < (options.sparseBelow ?? -Infinity) ? 1 : 0
      view = viewBounds(m)
      const { lng, lat } = m.getCenter()
      center = [mercX(lng), mercY(lat)]
      camera = options.falloff ? plantingCamera(m) : null
      options.prepare?.(m)
    },
    *prepareSteps() {
      if (!map) return
      let features: any[]
      try {
        features = map.querySourceFeatures(options.source, { sourceLayer: options.sourceLayer })
      } catch {
        return
      }
      for (const feature of features) {
        if (feature.geometry?.type === 'Point') continue
        const grid = options.grid(feature)
        const tile = grid && tileBounds(feature)
        if (!grid || !tile) continue
        for (const b of blocksOf(feature, grid, tile))
          if (!cached(b)) {
            yield* plantSteps(feature, grid, b, options.clear(feature))
            yield
          }
      }
    },
    positions: feature => shownOf(feature).points.map(([lng, lat]) => [lng, lat] as [number, number]),
    toInstance(feature, lng, lat, index) {
      const { points, levels } = shownOf(feature)
      const point = points[index]
      if (!point) return null
      const level = levels[index]
      return options.instance(feature, lng, lat, point[2], point[3], { interior: point[4], sparse: level >= 1, level })
    },
  }
}
