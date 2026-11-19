/**
 * Road names, path names and route shields laid on the decks. A basemap name
 * runs on past a bridge's ends, so each one that meets a deck is cut at them and
 * its stretches on the deck drawn again at the deck's height; the basemap's own,
 * clipped where they stand on a deck, keep the rest on the ground.
 */
import type { FilterSpecification, LayerSpecification } from '@maplibre/maplibre-gl-style-spec'
import { combineFilters } from '@/lib/map-style/combine-filters'
import { ANCHOR_PROPERTY, HEIGHT_PROPERTY } from '@/lib/map-elevation/elevated-lines'

type LngLat = [number, number]
type StyleLayer = { id: string; type: string; 'source-layer'?: string }

/** Deck height under a point, as the decks draw it; `along` picks the deck running that way. */
export type DeckHeightAt = (lng: number, lat: number, along?: [number, number]) => number | null

export const DECK_LABEL_SOURCE = 'deck-labels'
export const DECK_LABEL_SUFFIX = ':deck'
export const DECK_HEIGHT = 'deck_height'

/** Metres between the points a name is tested for a deck at. */
const STEP = 5
/** Metres a deck may rise along one stretch of name drawn at a single height, once it is long enough to hold a name. */
const TOLERANCE = 4
const MIN_LENGTH = 120

export function isDeckName(layer: StyleLayer): boolean {
  return layer.type === 'symbol' && layer['source-layer'] === 'transportation_name'
}

const WORLD: LngLat[] = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]

/**
 * Whether a feature stays clear of every deck. `within` the world with the decks cut out
 * misses a feature inside two overlapping decks, which the cut-outs cancel; the second test catches it.
 */
export function offDecks(footprint: GeoJSON.MultiPolygon): FilterSpecification {
  const holes = footprint.coordinates.map(polygon => polygon[0])
  return ['all', ['within', { type: 'Polygon', coordinates: [WORLD, ...holes] }], ['!', ['within', footprint]]] as FilterSpecification
}

export function onDecks(footprint: GeoJSON.MultiPolygon): FilterSpecification {
  return ['!', offDecks(footprint)] as FilterSpecification
}

/** A stretch of a name, at the height of the deck it lies on or, with none, on the ground. */
export type DeckPiece = { line: LngLat[]; height: number | null }

const metresPerDegree = 111_320

/** A line cut where it goes on and off decks, and where its deck rises past `tolerance` along a stretch `minLength` long. */
export function deckPieces(line: LngLat[], heightAt: DeckHeightAt, { step = STEP, tolerance = TOLERANCE, minLength = MIN_LENGTH } = {}): DeckPiece[] {
  const samples: Array<{ point: LngLat; height: number | null; vertex: boolean }> = []
  for (let i = 0; i < line.length - 1; i++) {
    const [a, b] = [line[i], line[i + 1]]
    const east = (b[0] - a[0]) * metresPerDegree * Math.cos((a[1] * Math.PI) / 180)
    const north = (b[1] - a[1]) * metresPerDegree
    const length = Math.hypot(east, north)
    if (!length) continue
    // Mercator x runs east, y runs south.
    const along: [number, number] = [east / length, -north / length]
    const n = Math.max(1, Math.ceil(length / step))
    for (let k = 0; k < n; k++) {
      const t = k / n
      const point: LngLat = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
      samples.push({ point, height: heightAt(point[0], point[1], along), vertex: k === 0 })
    }
  }
  const last = line.at(-1)
  if (!samples.length || !last) return []
  samples.push({ point: last, height: samples.at(-1)!.height, vertex: true })

  const pieces: Array<{ points: typeof samples; low: number; high: number }> = []
  for (const sample of samples) {
    const piece = pieces.at(-1)
    const h = sample.height
    const fits = piece && (piece.points[0].height == null
      ? h == null
      : h != null && (piece.points.length * step < minLength || Math.max(piece.high, h) - Math.min(piece.low, h) <= tolerance))
    if (piece && fits) {
      piece.points.push(sample)
      if (h != null) [piece.low, piece.high] = [Math.min(piece.low, h), Math.max(piece.high, h)]
      continue
    }
    // Pieces meet at a shared point, so the name's line is not broken between them.
    if (piece) piece.points.push({ ...sample, vertex: true })
    pieces.push({ points: [sample], low: h ?? 0, high: h ?? 0 })
  }
  return pieces.flatMap(({ points }) => {
    const kept = points.filter((p, i) => p.vertex || i === 0 || i === points.length - 1)
    if (kept.length < 2) return []
    const heights = points.flatMap(p => (p.height == null ? [] : [p.height]))
    const height = points[0].height == null ? null : heights.reduce((s, h) => s + h, 0) / heights.length
    return [{ line: kept.map(p => p.point), height }]
  })
}

/** A tile's bounds in degrees: west, south, east, north. */
export function tileBounds(z: number, x: number, y: number): [number, number, number, number] {
  const n = 2 ** z
  const lat = (row: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / n))) * 180) / Math.PI
  return [(x / n) * 360 - 180, lat(y + 1), ((x + 1) / n) * 360 - 180, lat(y)]
}

/** The parts of a line inside a box; a tile's names reach past its edge, where the next tile's take over. */
export function clipLine(line: LngLat[], [west, south, east, north]: [number, number, number, number]): LngLat[][] {
  const parts: LngLat[][] = []
  let current: LngLat[] = []
  for (let i = 0; i < line.length - 1; i++) {
    const [a, b] = [line[i], line[i + 1]]
    const d = [b[0] - a[0], b[1] - a[1]]
    let [t0, t1] = [0, 1]
    const edges: Array<[number, number]> = [[-d[0], a[0] - west], [d[0], east - a[0]], [-d[1], a[1] - south], [d[1], north - a[1]]]
    let inside = true
    for (const [p, q] of edges) {
      if (p === 0) {
        if (q < 0) inside = false
        continue
      }
      const r = q / p
      if (p < 0) t0 = Math.max(t0, r)
      else t1 = Math.min(t1, r)
    }
    if (!inside || t0 > t1) {
      if (current.length > 1) parts.push(current)
      current = []
      continue
    }
    const at = (t: number): LngLat => [a[0] + d[0] * t, a[1] + d[1] * t]
    if (!current.length || t0 > 0) {
      if (current.length > 1) parts.push(current)
      current = [at(t0)]
    }
    current.push(at(t1))
    if (t1 < 1) {
      parts.push(current)
      current = []
    }
  }
  if (current.length > 1) parts.push(current)
  return parts
}

/** A basemap name as queried from its tile, which `clipLine` cuts it back to. */
export type TileName = { geometry: GeoJSON.Geometry; properties: Record<string, unknown>; tile?: [z: number, x: number, y: number] }

export function deckLabelFeatures(names: TileName[], heightAt: DeckHeightAt): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  const add = (geometry: GeoJSON.Geometry, properties: Record<string, unknown>, height: number | null) => {
    if (height != null) features.push({ type: 'Feature', geometry, properties: { ...properties, [DECK_HEIGHT]: height } })
  }
  for (const { geometry, properties, tile } of names) {
    const bounds = tile && tileBounds(...tile)
    if (geometry.type === 'Point') {
      const [lng, lat] = geometry.coordinates
      const [w, s, e, n] = bounds ?? [-180, -90, 180, 90]
      if (lng >= w && lng < e && lat > s && lat <= n) add(geometry, properties, heightAt(lng, lat))
      continue
    }
    const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.type === 'MultiLineString' ? geometry.coordinates : []
    for (const line of lines as LngLat[][])
      for (const part of bounds ? clipLine(line, bounds) : [line])
        for (const piece of deckPieces(part, heightAt)) add({ type: 'LineString', coordinates: piece.line }, properties, piece.height)
  }
  return { type: 'FeatureCollection', features }
}

/** A basemap name layer drawn again from the names' stretches on the decks, each at its deck's height. */
export function deckLabelLayer(layer: LayerSpecification, filter: unknown): LayerSpecification {
  const { 'source-layer': _, filter: __, ...spec } = layer as LayerSpecification & { 'source-layer'?: string; filter?: unknown; layout?: Record<string, unknown> }
  const combined = combineFilters([filter])
  return {
    ...spec,
    id: `${layer.id}${DECK_LABEL_SUFFIX}`,
    source: DECK_LABEL_SOURCE,
    ...(combined ? { filter: combined } : {}),
    layout: {
      ...spec.layout,
      [HEIGHT_PROPERTY]: ['get', DECK_HEIGHT],
      [ANCHOR_PROPERTY]: 'absolute',
    },
  } as LayerSpecification
}
