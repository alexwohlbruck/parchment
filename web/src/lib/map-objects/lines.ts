/**
 * Lines stood up as objects, from barrelman's `object_lines`: fences, walls,
 * hedges and guard rails as stretched spans, power lines as towers or poles
 * at their vertices with wires between, and electrified track as masts every
 * so often with the overhead wire along it.
 *
 * A line crosses tiles, so every piece is kept and each places only what falls
 * inside its own tile.
 */
import { DETAIL_SOURCE, OBJECT_LINE_TILES } from '@/lib/map-style/detail-layers'
import type { ObjectInstance, ObjectSourceSpec } from './object-layer'
import { bearingOf } from './furniture'
import { cellHash } from './forest'
import { tagged } from './vary'

export const LINE_MODELS = {
  'fence-span': '/models/fence-span.glb',
  'fence-post': '/models/fence-post.glb',
  'wall-span': '/models/wall-span.glb',
  'hedge-span': '/models/hedge-span.glb',
  'guard-rail-span': '/models/guard-rail-span.glb',
  'power-tower': '/models/power-tower.glb',
  'power-wires': '/models/power-wires.glb',
  'power-pole': '/models/power-pole.glb',
  'pole-wires': '/models/pole-wires.glb',
  'catenary-mast': '/models/catenary-mast.glb',
  'catenary-wires': '/models/catenary-wires.glb',
}

type LineModel = keyof typeof LINE_MODELS

/** Spans built at their height above the ground rather than a unit tall from it. */
export const HUNG_MODELS: LineModel[] = ['guard-rail-span', 'power-wires', 'pole-wires', 'catenary-wires']

/**
 * What each kind draws: a span along every segment, and what stands at its
 * joints. A `seated` span hangs at a fixed height rather than standing at a
 * tagged one, and is built in place above the ground; see `HUNG_MODELS`.
 */
const KINDS: Record<string, { span: LineModel; joint?: LineModel; height: number; every?: number; seated?: boolean }> = {
  fence: { span: 'fence-span', joint: 'fence-post', height: 1.5 },
  wall: { span: 'wall-span', height: 1.8 },
  retaining_wall: { span: 'wall-span', height: 1.2 },
  city_wall: { span: 'wall-span', height: 6 },
  hedge: { span: 'hedge-span', height: 1.6 },
  guard_rail: { span: 'guard-rail-span', height: 0.8, seated: true },
  power_line: { span: 'power-wires', joint: 'power-tower', height: 30, seated: true },
  power_minor_line: { span: 'pole-wires', joint: 'power-pole', height: 11.2, seated: true },
  catenary: { span: 'catenary-wires', joint: 'catenary-mast', height: 7.4, every: 55, seated: true },
}

const METRES_PER_DEGREE = 111320

type Placement = { lng: number; lat: number; model: LineModel; bearing: number; length?: number; seed: number }

type Bounds = { minLng: number; maxLng: number; minLat: number; maxLat: number }

function tileBounds(feature: any): Bounds | null {
  const { _x: x, _y: y, _z: z } = feature
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return null
  const n = 2 ** z
  const lat = (t: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * t) / n))) * 180) / Math.PI
  return { minLng: (x / n) * 360 - 180, maxLng: ((x + 1) / n) * 360 - 180, minLat: lat(y + 1), maxLat: lat(y) }
}

const inside = (b: Bounds | null, lng: number, lat: number) =>
  !b || (lng >= b.minLng && lng < b.maxLng && lat >= b.minLat && lat < b.maxLat)

/** Compass bearing and length in metres from a to b, flat-earth over a segment. */
export function measure(a: number[], b: number[]): { bearing: number; length: number } {
  const k = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180)
  const east = (b[0] - a[0]) * k * METRES_PER_DEGREE
  const north = (b[1] - a[1]) * METRES_PER_DEGREE
  return { bearing: ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360, length: Math.hypot(east, north) }
}

/** The bearing halfway between two, the way a tower turns to hold a bend. */
function between(b1: number, b2: number): number {
  const r = (d: number) => (d * Math.PI) / 180
  return ((Math.atan2(Math.sin(r(b1)) + Math.sin(r(b2)), Math.cos(r(b1)) + Math.cos(r(b2))) * 180) / Math.PI + 360) % 360
}

function linesOf(geometry: any): number[][][] {
  switch (geometry?.type) {
    case 'LineString': return [geometry.coordinates]
    case 'MultiLineString': return geometry.coordinates
    case 'Polygon': return geometry.coordinates
    case 'MultiPolygon': return geometry.coordinates.flat()
    default: return []
  }
}

/** Every span and joint one tile piece of a line places. */
export function placeLine(kind: string, geometry: any, bounds: Bounds | null): Placement[] {
  const spec = KINDS[kind]
  if (!spec) return []
  const out: Placement[] = []
  for (const line of linesOf(geometry)) {
    const segments = line.slice(1).map((b, k) => ({ a: line[k], b, ...measure(line[k], b) }))
    segments.forEach((s, k) => {
      const lng = (s.a[0] + s.b[0]) / 2
      const lat = (s.a[1] + s.b[1]) / 2
      if (s.length > 0.2 && inside(bounds, lng, lat))
        out.push({ lng, lat, model: spec.span, bearing: s.bearing, length: s.length, seed: k })
    })
    if (!spec.joint) continue
    if (spec.every) {
      let carried = spec.every / 2
      for (const [k, s] of segments.entries()) {
        for (let d = carried; d < s.length; d += spec.every) {
          const t = d / s.length
          const lng = s.a[0] + (s.b[0] - s.a[0]) * t
          const lat = s.a[1] + (s.b[1] - s.a[1]) * t
          if (inside(bounds, lng, lat)) out.push({ lng, lat, model: spec.joint, bearing: s.bearing, seed: k })
        }
        carried = (carried - s.length) % spec.every
        if (carried < 0) carried += spec.every
      }
    } else {
      line.forEach((p, k) => {
        if (!inside(bounds, p[0], p[1])) return
        const before = segments[k - 1]?.bearing
        const after = segments[k]?.bearing
        const bearing = before === undefined ? after : after === undefined ? before : between(before, after)
        if (bearing !== undefined) out.push({ lng: p[0], lat: p[1], model: spec.joint!, bearing, seed: k })
      })
    }
  }
  return out
}

/**
 * A placement as an instance; a span's x runs along its segment. Barrier spans
 * take their tagged height at a real thickness. Joints, and spans hung at a fixed
 * height on them, scale as a whole with the joint.
 */
export function lineInstance(kind: string, tagHeight: unknown, p: Placement): ObjectInstance {
  const spec = KINDS[kind]
  const span = p.length !== undefined
  const height = span && !spec.seated ? (tagged(tagHeight, 0.3, 30) ?? spec.height) : spec.height
  return {
    lng: p.lng,
    lat: p.lat,
    height,
    spread: span && !spec.seated ? 1 : height,
    ...(span ? { length: p.length } : {}),
    heading: bearingOf((p.bearing + 90) % 360)!,
    shade: 0.92 + cellHash(p.seed, Math.round(p.lng * 1e5), 1) * 0.12,
    model: p.model,
  }
}

const current = new WeakMap<object, Placement[]>()

function placementsOf(feature: any): Placement[] {
  let placed = current.get(feature)
  if (!placed) {
    placed = placeLine(feature.properties?.kind, feature.geometry, tileBounds(feature))
    current.set(feature, placed)
  }
  return placed
}

export const LINE_OBJECTS: ObjectSourceSpec = {
  source: DETAIL_SOURCE,
  sourceLayer: OBJECT_LINE_TILES,
  minzoom: 16,
  distinct: false,
  budget: 8000,
  positions: feature => placementsOf(feature).map(p => [p.lng, p.lat] as [number, number]),
  toInstance(feature, _lng, _lat, index) {
    const p = placementsOf(feature)[index]
    return p ? lineInstance(feature.properties.kind, feature.properties.height, p) : null
  },
}
