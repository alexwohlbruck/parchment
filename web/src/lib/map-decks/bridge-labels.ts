/**
 * Road names and one-way arrows stood on the 3D bridge decks. The basemap's
 * lines carry no heights, so the stretch of each over a deck is copied out
 * with the deck surface's heights along it, in the MapLibre fork's
 * `symbol-elevation-profile` format, and each placement stands at its own.
 */
import { haversineMeters } from '@/lib/geo/geo-line'
import { mercator } from './decks'
import { deckFootprints } from './footprints'

type LngLat = [number, number]
type Sample = [lng: number, lat: number, height: number]
type Box = [west: number, south: number, east: number, north: number]

/** Metres up the deck surface is drawn at a point, or null off every deck. */
export type SurfaceAt = (lng: number, lat: number) => number | null
/** Whether a line at a point, heading along `heading` (degrees), rides a bridge rather than passing beneath one. */
export type Rides = (p: LngLat, heading: LngLat) => boolean

/** Metres between the heights read along a line. */
export const SAMPLE_STEP = 5
/** Metres to either side a deck is looked for under a line drawn between its carriageways, nearest first. */
const SIDE_REACH = [4, 8, 12]
/** Metres either side of a raised stretch the flat labels are left out. */
const CLIP_HALF_WIDTH = 8
const METRES_PER_DEGREE = 111_320

/** The basemap source layers whose labels are raised, each copied into a source of its own so the layers' filters still apply. */
export const RAISED_SOURCE_LAYERS = ['transportation', 'transportation_name'] as const
export const raisedSource = (sourceLayer: string) => `bridge-labels:${sourceLayer}`
export const raisedLayerId = (id: string) => `${id}:raised`

/** The stretches of `line` over a deck, each point with the deck's height there. */
export function deckStretches(line: LngLat[], surfaceAt: SurfaceAt, step = SAMPLE_STEP, rides: Rides = () => true): Sample[][] {
  const stretches: Sample[][] = []
  let current: Sample[] = []
  const take = (lng: number, lat: number, heading: LngLat) => {
    const height = rides([lng, lat], heading) ? surfaceBeside(surfaceAt, [lng, lat], heading) : null
    if (height !== null) return void current.push([lng, lat, height])
    if (current.length > 1) stretches.push(current)
    current = []
  }
  line.forEach(([lng, lat], i) => {
    const next = line[i + 1]
    if (!next) return take(lng, lat, [lng - line[i - 1][0], lat - line[i - 1][1]])
    const heading: LngLat = [next[0] - lng, next[1] - lat]
    const steps = Math.max(1, Math.ceil(haversineMeters(lat, lng, next[1], next[0]) / step))
    for (let k = 0; k < steps; k++) take(lng + (heading[0] * k) / steps, lat + (heading[1] * k) / steps, heading)
  })
  if (current.length > 1) stretches.push(current)
  return stretches
}

/** The deck under a point, or failing that the nearest one to either side of its heading, as under a name drawn down a bridge's median. */
function surfaceBeside(surfaceAt: SurfaceAt, [lng, lat]: LngLat, heading: LngLat): number | null {
  const under = surfaceAt(lng, lat)
  if (under !== null) return under
  const k = Math.cos((lat * Math.PI) / 180)
  const length = Math.hypot(heading[0] * k, heading[1]) || 1
  const [nx, ny] = [-heading[1] / length / k, (heading[0] * k) / length]
  for (const metres of SIDE_REACH) {
    const d = metres / METRES_PER_DEGREE
    const heights = [surfaceAt(lng + nx * d, lat + ny * d), surfaceAt(lng - nx * d, lat - ny * d)].filter((h): h is number => h !== null)
    if (heights.length) return Math.max(...heights)
  }
  return null
}

/** A run of the fork's profile format: degrees ×1e7 as deltas after the first point, heights in decimetres over the datum. */
export function encodeProfile(samples: Sample[]): string {
  let [x, y] = [0, 0]
  return samples
    .map(([lng, lat, height]) => {
      const [nx, ny] = [Math.round(lng * 1e7), Math.round(lat * 1e7)]
      const out = `${nx - x},${ny - y},${Math.round(height * 10)}`
      ;[x, y] = [nx, ny]
      return out
    })
    .join(',')
}

export const lines = (geometry: GeoJSON.Geometry): LngLat[][] =>
  geometry.type === 'LineString' ? [geometry.coordinates as LngLat[]] : geometry.type === 'MultiLineString' ? (geometry.coordinates as LngLat[][]) : []

const overlaps = (a: Box, b: Box) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]

function boxOf(points: number[][]): Box {
  const box: Box = [Infinity, Infinity, -Infinity, -Infinity]
  for (const [x, y] of points) {
    box[0] = Math.min(box[0], x)
    box[1] = Math.min(box[1], y)
    box[2] = Math.max(box[2], x)
    box[3] = Math.max(box[3], y)
  }
  return box
}

/** Metres from a bridge's line a line riding it may lie, and how far its heading may turn from the bridge's, as a cosine. */
const RIDE_REACH = 6
const RIDE_ALIGNED = 0.9
/** Degrees per grid cell the bridge segments are indexed by. */
const CELL = 0.0005

/** Whether a line rides one of `bridges`: near one of its segments and running the same way, either direction. */
export function ridesBridges(bridges: LngLat[][]): Rides {
  const cells = new Map<string, Array<[LngLat, LngLat]>>()
  for (const line of bridges)
    for (let i = 1; i < line.length; i++) {
      const [a, b] = [line[i - 1], line[i]]
      const [w, s, e, n] = boxOf([a, b])
      for (let cx = Math.floor(w / CELL); cx <= Math.floor(e / CELL); cx++)
        for (let cy = Math.floor(s / CELL); cy <= Math.floor(n / CELL); cy++) {
          const key = `${cx}:${cy}`
          const list = cells.get(key)
          if (list) list.push([a, b])
          else cells.set(key, [[a, b]])
        }
    }
  return ([lng, lat], heading) => {
    const k = Math.cos((lat * Math.PI) / 180)
    const [hx, hy] = [heading[0] * k, heading[1]]
    const hl = Math.hypot(hx, hy)
    const reach = RIDE_REACH / METRES_PER_DEGREE
    for (let cx = Math.floor((lng - reach / k) / CELL); cx <= Math.floor((lng + reach / k) / CELL); cx++)
      for (let cy = Math.floor((lat - reach) / CELL); cy <= Math.floor((lat + reach) / CELL); cy++)
        for (const [a, b] of cells.get(`${cx}:${cy}`) ?? []) {
          const [dx, dy] = [(b[0] - a[0]) * k, b[1] - a[1]]
          const length2 = dx * dx + dy * dy
          if (!length2) continue
          const [px, py] = [(lng - a[0]) * k, lat - a[1]]
          const t = Math.max(0, Math.min(1, (px * dx + py * dy) / length2))
          if (Math.hypot(px - dx * t, py - dy * t) > reach) continue
          if (!hl || Math.abs(hx * dx + hy * dy) / (hl * Math.sqrt(length2)) >= RIDE_ALIGNED) return true
        }
    return false
  }
}

/** Where decks are: each footprint's box, and whether a point is close enough to one to stand on it or beside it. */
export type DeckReach = { boxes: Box[]; near: (lng: number, lat: number) => boolean }

const cellKey = (cx: number, cy: number) => cx * 1_000_000 + cy

/**
 * The ground within reach of the decks, as grid cells. A footprint is a ribbon,
 * one side out and the other back, so it is covered a crosswise slice at a time:
 * its whole box would take in every street a diagonal viaduct passes.
 */
export function deckReach(footprints: GeoJSON.MultiPolygon): DeckReach {
  const cells = new Set<number>()
  const reach = (SIDE_REACH.at(-1)! + CLIP_HALF_WIDTH) / METRES_PER_DEGREE
  const mark = (points: number[][]) => {
    const [w, s, e, n] = boxOf(points)
    const k = Math.cos((s * Math.PI) / 180)
    for (let cx = Math.floor((w - reach / k) / CELL); cx <= Math.floor((e + reach / k) / CELL); cx++)
      for (let cy = Math.floor((s - reach) / CELL); cy <= Math.floor((n + reach) / CELL); cy++) cells.add(cellKey(cx, cy))
  }
  for (const [ring] of footprints.coordinates) {
    const sides = ring.length - 1
    if (sides % 2) mark(ring)
    else
      for (let i = 0; i + 1 < sides / 2; i++) {
        const [a, b, c, d] = [ring[i], ring[i + 1], ring[sides - 1 - i], ring[sides - 2 - i]]
        const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (CELL / 2)))
        const along = (from: number[], to: number[], t: number) => [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]
        for (let k = 0; k < steps; k++) mark([along(a, b, k / steps), along(a, b, (k + 1) / steps), along(c, d, k / steps), along(c, d, (k + 1) / steps)])
      }
  }
  return {
    boxes: footprints.coordinates.map(polygon => boxOf(polygon[0])),
    near: (lng, lat) => cells.has(cellKey(Math.floor(lng / CELL), Math.floor(lat / CELL))),
  }
}

/**
 * Each stretch of `features` over a deck, as a line with its `elevation`
 * profile and the feature's own properties. A line clear of every deck's box
 * is never sampled, and one repeated across tiles is copied once.
 */
export function raisedLabelFeatures(features: Array<Pick<GeoJSON.Feature, 'geometry' | 'properties'>>, decks: DeckReach, surfaceAt: SurfaceAt, rides: Rides = () => true): GeoJSON.Feature<GeoJSON.LineString>[] {
  const reached: Rides = (p, heading) => decks.near(p[0], p[1]) && rides(p, heading)
  const seen = new Set<string>()
  const out: GeoJSON.Feature<GeoJSON.LineString>[] = []
  for (const { geometry, properties } of features) {
    for (const line of lines(geometry)) {
      if (line.length < 2) continue
      const box = boxOf(line)
      if (!decks.boxes.some(deck => overlaps(deck, box))) continue
      const key = `${JSON.stringify(properties)}|${line.flat().join(',')}`
      if (seen.has(key)) continue
      seen.add(key)
      for (const stretch of deckStretches(line, surfaceAt, SAMPLE_STEP, reached))
        out.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: stretch.map(([lng, lat]) => [lng, lat]) }, properties: { ...properties, elevation: encodeProfile(stretch) } })
    }
  }
  return out
}

export type RaisedLabels = Record<(typeof RAISED_SOURCE_LAYERS)[number], GeoJSON.Feature<GeoJSON.LineString>[]>
type TileFeature = Pick<GeoJSON.Feature, 'geometry' | 'properties'>

/**
 * One tile's raised labels. Names carry no bridge tag: one is raised only
 * where it runs along a bridge's road, not where it passes beneath a deck. A
 * tile's own roads answer that, its buffer reaching past any name inside it.
 */
export function raisedTileLabels(roads: TileFeature[], names: TileFeature[], decks: DeckReach, surfaceAt: SurfaceAt): RaisedLabels {
  const bridges = roads.filter(f => f.properties?.brunnel === 'bridge')
  return {
    transportation: raisedLabelFeatures(bridges, decks, surfaceAt),
    transportation_name: raisedLabelFeatures(names, decks, surfaceAt, ridesBridges(bridges.flatMap(f => lines(f.geometry)))),
  }
}

/** The ground under raised stretches, where their flat labels would lie beneath them. */
export function stretchFootprints(stretches: GeoJSON.Feature<GeoJSON.LineString>[]): GeoJSON.MultiPolygon {
  return deckFootprints(stretches.map(f => ({ points: f.geometry.coordinates.map(mercator), edges: [CLIP_HALF_WIDTH, CLIP_HALF_WIDTH] })))
}

type SymbolSpec = { id: string; type: string; source?: string; 'source-layer'?: string; layout?: Record<string, unknown> }

/** A copy of a basemap label layer reading the raised stretches, each placement at the deck's height under it. */
export function raisedLabelLayer<T extends SymbolSpec>({ 'source-layer': sourceLayer, ...layer }: T): Omit<T, 'source-layer'> {
  return {
    ...layer,
    id: raisedLayerId(layer.id),
    source: raisedSource(sourceLayer ?? ''),
    layout: { ...layer.layout, 'symbol-elevation-profile': ['get', 'elevation'] },
  }
}
