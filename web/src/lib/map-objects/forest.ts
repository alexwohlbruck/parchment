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
export function plantForest(rings: Ring[], bounds: Bounds, ex: ForestExclusions): ForestPoint[] {
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

  const r = INTERIOR_REACH
  const width = i1 - i0 + 1 + 2 * r
  const clear = new Uint8Array(width * (j1 - j0 + 1 + 2 * r))
  const at = (i: number, j: number) => (j - j0 + r) * width + (i - i0 + r)
  const point = (i: number, j: number): Point => [
    (i + 0.1 + cellHash(i, j, 1) * 0.8) * FOREST_SPACING,
    (j + 0.1 + cellHash(i, j, 2) * 0.8) * FOREST_SPACING,
  ]
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
const HEIGHT = { broadleaf: { min: 15, max: 28 }, conifer: { min: 17, max: 32 } }
const SPREAD = { min: 1.15, max: 1.55 }

/** Suffix on a tree's trunkless crown, built alongside it. */
export const CROWN_SUFFIX = '-crown'

/**
 * Below this zoom a wood is planted at every other cell each way, a quarter of
 * the trees, a little wider to fill in, standing on the wood's own green.
 */
export const SPARSE_BELOW_ZOOM = 16
const SPARSE_SPREAD = 1.3

export function forestTree(
  lng: number,
  lat: number,
  i: number,
  j: number,
  { interior = false, sparse = false } = {},
): ObjectInstance {
  const family = cellHash(i, j, 3) < 0.7 ? 'broadleaf' : 'conifer'
  const height = lerp(HEIGHT[family], cellHash(i, j, 4))
  const model = pick(TREE_FAMILIES[family], cellHash(i, j, 9))
  return {
    lng,
    lat,
    height,
    spread: height * lerp(SPREAD, cellHash(i, j, 5)) * (sparse ? SPARSE_SPREAD : 1),
    heading: cellHash(i, j, 6) * Math.PI * 2,
    shade: 0.84 + cellHash(i, j, 7) * 0.24,
    tint: cellHash(i, j, 8),
    model: interior && !sparse ? `${model}${CROWN_SUFFIX}` : model,
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
const MAX_PLANTED = 4000

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

const current = new WeakMap<object, ForestPoint[]>()
const thinned = new WeakMap<object, ForestPoint[]>()
let sparse = false

function plantingOf(feature: any) {
  const known = current.get(feature)
  if (known) return known
  const key = pieceKey(feature)
  let points = planted.get(key)
  if (!points) {
    const tile = tileBounds(feature)
    exclusions ??= source ? exclusionsFor(source) : buildExclusions([], [])
    points = tile ? polygonsOf(feature.geometry).flatMap(rings => plantForest(rings, tile, exclusions!)) : []
    if (planted.size >= MAX_PLANTED) planted.clear()
    planted.set(key, points)
  }
  current.set(feature, points)
  return points
}

/** The trees a wood shows at the current zoom: every cell, or every other one each way. */
function shownOf(feature: any): ForestPoint[] {
  const all = plantingOf(feature)
  if (!sparse) return all
  let some = thinned.get(feature)
  if (!some) {
    some = all.filter(([, , i, j]) => i % 2 === 0 && j % 2 === 0)
    thinned.set(feature, some)
  }
  return some
}

export const FOREST_OBJECTS: ObjectSourceSpec = {
  source: BASEMAP_SOURCE,
  sourceLayer: 'landcover',
  minzoom: 15,
  distinct: false,
  followsView: true,
  budget: 6000,
  prepare(map, spec) {
    source = { map, layer: spec.source }
    exclusions = null
    sparse = map.getZoom() < SPARSE_BELOW_ZOOM
  },
  positions(feature) {
    if (feature.properties?.class !== 'wood') return []
    return shownOf(feature).map(([lng, lat]) => [lng, lat] as [number, number])
  },
  toInstance(feature, lng, lat, index) {
    const point = shownOf(feature)[index]
    return point ? forestTree(lng, lat, point[2], point[3], { interior: point[4], sparse }) : null
  },
}
