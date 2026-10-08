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

/** Index the ways and open areas a forest must leave clear. */
export function buildExclusions(ways: any[], areas: any[]): ForestExclusions {
  const metre = MERCATOR_METRE
  const cell = 32 * metre
  const segments = new Map<number, number[][]>()
  for (const way of ways) {
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
export function plant(rings: Ring[], bounds: Bounds, ex: ForestExclusions | null, grid: Grid): PlantedPoint[] {
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

  const r = INTERIOR_REACH
  const width = i1 - i0 + 1 + 2 * r
  const clear = new Uint8Array(width * (j1 - j0 + 1 + 2 * r))
  const at = (i: number, j: number) => (j - j0 + r) * width + (i - i0 + r)
  const point = (i: number, j: number): Point => [
    (i + slack + cellHash(i, j, 1) * grid.jitter) * sx,
    (j + slack + cellHash(i, j, 2) * grid.jitter) * sy,
  ]
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

/** Where a planted object stands within its area, and how thinly the area is planted. */
export type PlantedPlace = { interior: boolean; sparse: boolean }

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

function exclusionsFor(map: any, basemap: string, detail: (sourceLayer: string) => [string, string?]): ForestExclusions {
  const query = (source: string, sourceLayer?: string) => {
    try {
      return map.querySourceFeatures(source, sourceLayer ? { sourceLayer } : {})
    } catch {
      return []
    }
  }
  return buildExclusions(query(basemap, 'transportation'), [
    ...query(basemap, 'building'),
    ...query(basemap, 'water'),
    ...query(basemap, 'landuse').filter((f: any) => OPEN_LANDUSE.has(f.properties?.class)),
    ...OPEN_DETAIL.flatMap(([layer, keep]) => query(...detail(layer)).filter(keep)),
  ])
}

/** The view in mercator units, padded a tenth each way so shadows from just off screen land. */
function viewBounds(map: any): Bounds | null {
  const b = map.getBounds?.()
  if (!b) return null
  const [x0, x1, y0, y1] = [mercX(b.getWest()), mercX(b.getEast()), mercY(b.getNorth()), mercY(b.getSouth())]
  const pad = Math.max(x1 - x0, y1 - y0) * 0.1
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

/**
 * An object spec that plants every polygon it reads, and stands an object on
 * every point. `grid` gives a feature's spacing, or null to leave it bare;
 * `clear` whether it keeps off the ways and buildings; `instance` shapes each
 * planted object from its cell.
 */
export function plantedSpec(options: {
  source: string
  sourceLayer: string
  minzoom: number
  budget: number
  /** Below this zoom only every other cell each way is planted. */
  sparseBelow?: number
  grid: (feature: any) => Grid | null
  clear: (feature: any) => boolean
  instance: (feature: any, lng: number, lat: number, i: number, j: number, place: PlantedPlace) => ObjectInstance | null
}): PlantedSpec {
  const planted = new Map<string, PlantedPoint[]>()
  const current = new WeakMap<object, PlantedPoint[]>()
  const thinned = new WeakMap<object, PlantedPoint[]>()
  let sparse = false
  let map: any = null
  let basemap = BASEMAP_SOURCE
  let detail: (sourceLayer: string) => [string, string?] = layer => [DETAIL_SOURCE, layer]
  let exclusions: ForestExclusions | null = null
  let view: Bounds | null = null
  let center: Point = [0, 0]

  /**
   * One tile piece planted block by block, only where trees can still make the
   * budget: inside the view and within the square around its centre that
   * `budget` objects at this spacing would fill. The budget keeps the nearest.
   */
  const plantPiece = (feature: any, grid: Grid, tile: Bounds, clear: boolean): PlantedPoint[] => {
    const key = pieceKey(feature)
    const pitch = Math.max(grid.dx, grid.dy) * MERCATOR_METRE * (sparse ? 2 : 1)
    const reach = Math.sqrt(options.budget / Math.PI) * pitch * 1.15
    const block = 16 * grid.dx * MERCATOR_METRE
    const area = {
      minX: Math.max(tile.minX, view?.minX ?? -Infinity, center[0] - reach),
      minY: Math.max(tile.minY, view?.minY ?? -Infinity, center[1] - reach),
      maxX: Math.min(tile.maxX, view?.maxX ?? Infinity, center[0] + reach),
      maxY: Math.min(tile.maxY, view?.maxY ?? Infinity, center[1] + reach),
    }
    const points: PlantedPoint[] = []
    let polygons: Ring[][] | null = null
    for (let bj = Math.floor(area.minY / block); bj * block < area.maxY; bj++)
      for (let bi = Math.floor(area.minX / block); bi * block < area.maxX; bi++) {
        const blockKey = `${key}|${bi},${bj}`
        let planting = planted.get(blockKey)
        if (!planting) {
          const bounds = {
            minX: Math.max(tile.minX, bi * block),
            minY: Math.max(tile.minY, bj * block),
            maxX: Math.min(tile.maxX, (bi + 1) * block),
            maxY: Math.min(tile.maxY, (bj + 1) * block),
          }
          polygons ??= polygonsOf(feature.geometry)
          if (clear) exclusions ??= map ? exclusionsFor(map, basemap, detail) : buildExclusions([], [])
          planting = bounds.minX < bounds.maxX && bounds.minY < bounds.maxY
            ? polygons.flatMap(rings => plant(rings, bounds, clear ? exclusions : null, grid))
            : []
          if (planted.size >= 20000) planted.clear()
          planted.set(blockKey, planting)
        }
        for (const p of planting) points.push(p)
      }
    return points
  }

  const plantingOf = (feature: any) => {
    const known = current.get(feature)
    if (known) return known
    let points: PlantedPoint[]
    if (feature.geometry?.type === 'Point') {
      const [lng, lat] = feature.geometry.coordinates
      points = [[lng, lat, Math.round(lng * 1e6), Math.round(lat * 1e6), false]]
    } else {
      const grid = options.grid(feature)
      const tile = tileBounds(feature)
      points = grid && tile ? plantPiece(feature, grid, tile, options.clear(feature)) : []
    }
    current.set(feature, points)
    return points
  }

  const shownOf = (feature: any) => {
    const all = plantingOf(feature)
    if (!sparse) return all
    let some = thinned.get(feature)
    if (!some) {
      some = all.filter(([, , i, j]) => i % 2 === 0 && j % 2 === 0)
      thinned.set(feature, some)
    }
    return some
  }

  return {
    source: options.source,
    sourceLayer: options.sourceLayer,
    exclusionsFrom: BASEMAP_SOURCE,
    minzoom: options.minzoom,
    distinct: false,
    followsView: true,
    budget: options.budget,
    prepare(m, spec) {
      map = m
      basemap = (spec as PlantedSpec).exclusionsFrom ?? BASEMAP_SOURCE
      detail = (spec as PlantedSpec).detailFrom ?? (layer => [DETAIL_SOURCE, layer])
      exclusions = null
      sparse = m.getZoom() < (options.sparseBelow ?? -Infinity)
      view = viewBounds(m)
      const { lng, lat } = m.getCenter()
      center = [mercX(lng), mercY(lat)]
    },
    positions: feature => shownOf(feature).map(([lng, lat]) => [lng, lat] as [number, number]),
    toInstance(feature, lng, lat, index) {
      const point = shownOf(feature)[index]
      return point ? options.instance(feature, lng, lat, point[2], point[3], { interior: point[4], sparse }) : null
    },
  }
}
