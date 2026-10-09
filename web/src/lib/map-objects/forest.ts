/**
 * Forests: woodland polygons planted with trees, kept off the roads, paths,
 * buildings, water and pitches that run through them.
 *
 * Trees stand on a jittered grid anchored to the world rather than to a tile,
 * so a forest is the same forest on every load and has no seams. Only the part
 * of each wood inside the view is planted, and each tile plants only inside its
 * own bounds, so a wood split across tiles is never planted twice.
 */
import { SOURCE as BASEMAP_SOURCE } from '@/lib/map-style/build'
import type { ObjectInstance, ObjectSourceSpec } from './object-layer'
import { TREE_FAMILIES } from './trees'
import { lerp, pick } from './vary'

/** Grid pitch in Web Mercator units: about 10 m of ground at US latitudes. */
export const FOREST_SPACING = 13 / 40075016.686

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

/** Index the ways and open areas a forest must leave clear. */
export function buildExclusions(ways: any[], areas: any[]): ForestExclusions {
  const metre = FOREST_SPACING / 13
  const cell = 32 * metre
  const segments = new Map<number, number[][]>()
  for (const way of ways) {
    if (way.properties?.brunnel === 'tunnel') continue
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

/** A planted grid point: [lng, lat, i, j, interior]. */
export type ForestPoint = [number, number, number, number, boolean]

/** Cells either way that must all be planted for a tree to count as inside the wood. */
const INTERIOR_REACH = 2

/**
 * Grid points inside a wood and inside `bounds`, clear of every exclusion,
 * each seeded from its cell. A point is interior when every cell within
 * `INTERIOR_REACH` is planted too: nothing there is seen but its crown.
 */
export function plantForest(rings: Ring[], bounds: Bounds, ex: ForestExclusions, stride = 1): ForestPoint[] {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const [x, y] of rings[0] ?? []) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x)
    minY = Math.min(minY, y); maxY = Math.max(maxY, y)
  }
  const j0 = Math.floor(Math.max(minY, bounds.minY) / FOREST_SPACING)
  const j1 = Math.floor(Math.min(maxY, bounds.maxY) / FOREST_SPACING)
  const i0 = Math.floor(Math.max(minX, bounds.minX) / FOREST_SPACING)
  const i1 = Math.floor(Math.min(maxX, bounds.maxX) / FOREST_SPACING)
  if (i1 < i0 || j1 < j0) return []

  const point = (i: number, j: number): Point => [
    (i + 0.1 + cellHash(i, j, 1) * 0.8) * FOREST_SPACING,
    (j + 0.1 + cellHash(i, j, 2) * 0.8) * FOREST_SPACING,
  ]
  const outside = ([x, y]: Point) => x < bounds.minX || x >= bounds.maxX || y < bounds.minY || y >= bounds.maxY
  const free = (spans: Span[], [x, y]: Point) => within(spans, x) && !nearWay(ex, x, y) && !inArea(ex, x, y)

  // A thinned planting is only ever drawn whole and far off, so it skips the interior test.
  if (stride > 1) {
    const out: ForestPoint[] = []
    const first = (n: number) => Math.ceil(n / stride) * stride
    for (let j = first(j0); j <= j1; j += stride) {
      const spans = spansAt(rings, (j + 0.5) * FOREST_SPACING)
      if (!spans.length) continue
      for (let i = first(i0); i <= i1; i += stride) {
        const p = point(i, j)
        if (!outside(p) && free(spans, p)) out.push([lngOf(p[0]), latOf(p[1]), i, j, false])
      }
    }
    return out
  }

  const r = INTERIOR_REACH
  const width = i1 - i0 + 1 + 2 * r
  const clear = new Uint8Array(width * (j1 - j0 + 1 + 2 * r))
  const at = (i: number, j: number) => (j - j0 + r) * width + (i - i0 + r)
  for (let j = j0 - r; j <= j1 + r; j++) {
    const spans = spansAt(rings, (j + 0.5) * FOREST_SPACING)
    if (!spans.length) continue
    for (let i = i0 - r; i <= i1 + r; i++) {
      const [x, y] = point(i, j)
      if (within(spans, x) && !nearWay(ex, x, y) && !inArea(ex, x, y)) clear[at(i, j)] = 1
    }
  }

  const out: ForestPoint[] = []
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

/** Woodland trees are old growth: taller and broader than the street trees of `trees.ts`. */
const HEIGHT = { broadleaf: { min: 13, max: 26 }, conifer: { min: 15, max: 30 } }
const SPREAD = { min: 1.1, max: 1.5 }

/** Suffix on a tree's trunkless crown, built alongside it. */
export const CROWN_SUFFIX = '-crown'

/**
 * Woods thin by how far apart their trees land on screen, not at a budget.
 * While neighbouring cells are at least `spacing` pixels apart every cell is
 * planted; each halving of that keeps every other cell each way, and survivors
 * grow to keep the canopy closed. A wood reaches the horizon with no edge, and
 * the count is bounded by screen area rather than by a radius.
 */
export const SPARSE_BELOW_ZOOM = 15
/** Trees a full screen of forest should come to, roughly; sets `spacing` from the screen size. */
const SCREEN_TREES = 9000
const MIN_SPACING = 5
/** Width of the band, in levels, over which one level gives way to the next. */
const DITHER = 0.7
const LEVEL_SPREAD = 1.3
const LEVEL_HEIGHT = 1.12
/** Beyond this level trees stop growing; they are a few pixels across by then. */
const MAX_GROWTH = 3

/** The camera in grid cells: ground position, height, and focal length in CSS pixels. */
export type ForestCamera = { x: number; y: number; altitude: number; focal: number; spacing: number }

/**
 * How far apart, in screen pixels, neighbouring cells `dx, dy` cells from the
 * camera's ground point appear: perspective, and foreshortening toward the horizon.
 */
export function screenSpacing(camera: ForestCamera, dx: number, dy: number): number {
  const distance = Math.hypot(dx, dy, camera.altitude)
  return (camera.focal / distance) * Math.sqrt(Math.max(camera.altitude / distance, 0.05))
}

/** Continuous thinning level for cells `apart` pixels apart: 0 while wide enough, +1 per halving. */
export function falloff(apart: number, spacing: number, floor = 0): number {
  return Math.max(floor, 1 + Math.log2(spacing / Math.max(apart, 1e-9)))
}

/** Where the camera stands over the ground, from the map's centre, pitch, bearing and zoom. */
export function forestCamera(map: any): ForestCamera {
  const { lng, lat } = map.getCenter()
  const canvas = map.getCanvas?.()
  const height = canvas?.clientHeight || 800
  const width = canvas?.clientWidth || 800
  const focal = map.transform?.cameraToCenterDistance ?? 1.5 * height
  const reach = focal / (512 * 2 ** map.getZoom()) / FOREST_SPACING
  const pitch = (map.getPitch() * Math.PI) / 180
  const bearing = (map.getBearing() * Math.PI) / 180
  const back = reach * Math.sin(pitch)
  return {
    x: mercX(lng) / FOREST_SPACING - back * Math.sin(bearing),
    y: mercY(lat) / FOREST_SPACING + back * Math.cos(bearing),
    altitude: reach * Math.cos(pitch),
    focal,
    spacing: Math.max(MIN_SPACING, Math.sqrt((width * height) / SCREEN_TREES)),
  }
}

/** How many times a cell's indices both halve evenly: the coarsest planting that keeps it. */
export function latticeLevel(i: number, j: number): number {
  let level = 0
  while (level < 16 && ((i | j) & ((1 << (level + 1)) - 1)) === 0) level++
  return level
}

/** Whether a cell keeps its tree at thinning level `level`, dithered so levels blend without an edge. */
export function keeps(i: number, j: number, level: number): boolean {
  return latticeLevel(i, j) >= Math.floor(level + (cellHash(i, j, 10) - 0.5) * DITHER)
}

const CROWNS: Record<string, string> = Object.fromEntries(
  Object.values(TREE_FAMILIES).flat().map(model => [model, `${model}${CROWN_SUFFIX}`]),
)

export function forestTree(
  lng: number,
  lat: number,
  i: number,
  j: number,
  { interior = false, level = 0 } = {},
): ObjectInstance {
  const family = cellHash(i, j, 3) < 0.7 ? 'broadleaf' : 'conifer'
  const growth = Math.min(level, MAX_GROWTH)
  const height = lerp(HEIGHT[family], cellHash(i, j, 4)) * LEVEL_HEIGHT ** growth
  const model = pick(TREE_FAMILIES[family], cellHash(i, j, 9))
  return {
    lng,
    lat,
    height,
    spread: height * lerp(SPREAD, cellHash(i, j, 5)) * LEVEL_SPREAD ** growth,
    heading: cellHash(i, j, 6) * Math.PI * 2,
    shade: 0.84 + cellHash(i, j, 7) * 0.24,
    tint: cellHash(i, j, 8),
    model: interior && level < 1 ? CROWNS[model] : model,
  }
}

/** The tile a queried feature came from, as mercator bounds. */
function tileBounds(feature: any): Bounds | null {
  const { _x: x, _y: y, _z: z } = feature
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return null
  const n = 2 ** z
  return { minX: x / n, minY: y / n, maxX: (x + 1) / n, maxY: (y + 1) / n }
}

/** Plantings by tile piece, so a pan re-ranks trees instead of re-planting them. */
const planted = new Map<string, ForestPoint[]>()
const MAX_PLANTED = 20000

let source: { map: any; layer: string } | null = null
let exclusions: ForestExclusions | null = null

function exclusionsFor({ map, layer }: { map: any; layer: string }): ForestExclusions {
  const query = (sourceLayer: string) => {
    try {
      return map.querySourceFeatures(layer, { sourceLayer })
    } catch {
      return []
    }
  }
  return buildExclusions(query('transportation'), [
    ...query('building'),
    ...query('water'),
    ...query('landuse').filter((f: any) => OPEN_LANDUSE.has(f.properties?.class)),
  ])
}

function pieceKey(feature: any): string {
  const g = feature.geometry
  const first = g?.type === 'MultiPolygon' ? g.coordinates[0]?.[0]?.[0] : g?.coordinates?.[0]?.[0]
  return `${feature._z}/${feature._x}/${feature._y}/${feature.id ?? ''}/${first}/${g?.coordinates?.length}`
}

type Shown = { points: ForestPoint[]; levels: number[] }
let shown = new Map<object, Shown>()
let floor = 0
let view: Bounds | null = null
let camera: ForestCamera = { x: 0, y: 0, altitude: 1, focal: 1, spacing: MIN_SPACING }

/** Planting goes block by block, so a wood is only planted where it is seen. */
const BLOCK_CELLS = 16
const BLOCK = BLOCK_CELLS * FOREST_SPACING

/** The view, padded a tenth each way so shadows from just off screen land. */
function plantingBounds(map: any): Bounds | null {
  const b = map.getBounds?.()
  if (!b) return null
  const [x0, x1, y0, y1] = [mercX(b.getWest()), mercX(b.getEast()), mercY(b.getNorth()), mercY(b.getSouth())]
  const pad = Math.max(x1 - x0, y1 - y0) * 0.1
  return { minX: x0 - pad, minY: y0 - pad, maxX: x1 + pad, maxY: y1 + pad }
}

const levelAt = (x: number, y: number) =>
  falloff(screenSpacing(camera, x - camera.x, y - camera.y), camera.spacing, floor)

/** The coarsest stride every cell of a block can be planted at: set by its point nearest the camera. */
function blockStride(bi: number, bj: number): number {
  const nx = Math.min(Math.max(camera.x, bi * BLOCK_CELLS), (bi + 1) * BLOCK_CELLS)
  const ny = Math.min(Math.max(camera.y, bj * BLOCK_CELLS), (bj + 1) * BLOCK_CELLS)
  const level = Math.floor(levelAt(nx, ny) - DITHER / 2)
  return 2 ** Math.max(0, Math.min(level, Math.log2(BLOCK_CELLS)))
}

/** A block already planted at a finer stride, cut down to `stride`, so a pan away from it need not replant. */
function coarsened(block: string, stride: number): ForestPoint[] | undefined {
  for (let finer = stride / 2; finer >= 1; finer /= 2) {
    const points = planted.get(`${block}|${finer}`)
    if (!points) continue
    const kept = points.filter(([, , i, j]) => i % stride === 0 && j % stride === 0).map(p => [...p.slice(0, 4), false] as ForestPoint)
    planted.set(`${block}|${stride}`, kept)
    return kept
  }
  return undefined
}

function plantingOf(feature: any): ForestPoint[] {
  const tile = tileBounds(feature)
  const points: ForestPoint[] = []
  if (!tile) return points
  const key = pieceKey(feature)
  const area = view
    ? { minX: Math.max(tile.minX, view.minX), minY: Math.max(tile.minY, view.minY), maxX: Math.min(tile.maxX, view.maxX), maxY: Math.min(tile.maxY, view.maxY) }
    : tile
  let polygons: Ring[][] | null = null
  for (let bj = Math.floor(area.minY / BLOCK); bj * BLOCK < area.maxY; bj++)
    for (let bi = Math.floor(area.minX / BLOCK); bi * BLOCK < area.maxX; bi++) {
      const stride = blockStride(bi, bj)
      const blockKey = `${key}|${bi},${bj}|${stride}`
      let block = planted.get(blockKey) ?? coarsened(`${key}|${bi},${bj}`, stride)
      if (!block) {
        const bounds = {
          minX: Math.max(tile.minX, bi * BLOCK),
          minY: Math.max(tile.minY, bj * BLOCK),
          maxX: Math.min(tile.maxX, (bi + 1) * BLOCK),
          maxY: Math.min(tile.maxY, (bj + 1) * BLOCK),
        }
        polygons ??= polygonsOf(feature.geometry)
        exclusions ??= source ? exclusionsFor(source) : buildExclusions([], [])
        block = bounds.minX < bounds.maxX && bounds.minY < bounds.maxY
          ? polygons.flatMap(rings => plantForest(rings, bounds, exclusions!, stride))
          : []
        if (planted.size >= MAX_PLANTED) planted.clear()
        planted.set(blockKey, block)
      }
      for (const p of block) points.push(p)
    }
  return points
}

/** The trees a wood shows from the current view, each with its thinning level. */
function shownOf(feature: any): Shown {
  let known = shown.get(feature)
  if (known) return known
  known = { points: [], levels: [] }
  for (const p of plantingOf(feature)) {
    const level = levelAt(p[2] + 0.5, p[3] + 0.5)
    if (!keeps(p[2], p[3], level)) continue
    known.points.push(p)
    known.levels.push(level)
  }
  shown.set(feature, known)
  return known
}

export const FOREST_OBJECTS: ObjectSourceSpec = {
  source: BASEMAP_SOURCE,
  sourceLayer: 'landcover',
  minzoom: 14,
  distinct: false,
  followsView: true,
  prepare(map, spec) {
    source = { map, layer: spec.source }
    exclusions = null
    shown = new Map()
    floor = map.getZoom() < SPARSE_BELOW_ZOOM ? 1 : 0
    view = plantingBounds(map)
    camera = forestCamera(map)
  },
  positions(feature) {
    if (feature.properties?.class !== 'wood') return []
    return shownOf(feature).points.map(([lng, lat]) => [lng, lat] as [number, number])
  },
  toInstance(feature, lng, lat, index) {
    const { points, levels } = shownOf(feature)
    const point = points[index]
    return point ? forestTree(lng, lat, point[2], point[3], { interior: point[4], level: levels[index] }) : null
  },
}
