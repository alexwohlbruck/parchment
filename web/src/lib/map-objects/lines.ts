/**
 * Lines stood up as objects, from barrelman's `object_lines`: fences, walls,
 * hedges and guard rails as stretched spans, power lines as in `power.ts`, and
 * electrified track as masts every so often with the overhead wire along it.
 *
 * A line crosses tiles, so every piece is kept and each places only what falls
 * inside its own tile.
 */
import { DETAIL_SOURCE, OBJECT_LINE_TILES } from '@/lib/map-style/detail-layers'
import type { ObjectInstance, ObjectSourceSpec } from './object-layer'
import { bearingOf } from './furniture'
import { cellHash } from './planting'
import { tagged } from './vary'
import { type Bounds, between, inside, linesOf, measure, pieceKey, tileBounds } from './tile-lines'
import { POWER_KINDS, type PowerPlacement, powerInstance, powerNetwork } from './power'

export const LINE_MODELS = {
  'fence-span': '/models/fence-span.glb',
  'fence-post': '/models/fence-post.glb',
  'wall-span': '/models/wall-span.glb',
  'hedge-span': '/models/hedge-span.glb',
  'guard-rail-span': '/models/guard-rail-span.glb',
  'catenary-mast': '/models/catenary-mast.glb',
  'catenary-wires': '/models/catenary-wires.glb',
}

type LineModel = keyof typeof LINE_MODELS

/** Spans built at their height above the ground rather than a unit tall from it. */
export const HUNG_MODELS: LineModel[] = ['guard-rail-span', 'catenary-wires']

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
  catenary: { span: 'catenary-wires', joint: 'catenary-mast', height: 7.4, every: 55, seated: true },
}

/** Longest piece a span is cut into, in metres, so it can bend with the ground. */
export const LONGEST_PIECE = 20

type Placement = { lng: number; lat: number; model: LineModel; bearing: number; length?: number; seed: number }

/** Every span and joint one tile piece of a line places. */
export function placeLine(kind: string, geometry: any, bounds: Bounds | null): Placement[] {
  const spec = KINDS[kind]
  if (!spec) return []
  const out: Placement[] = []
  for (const line of linesOf(geometry)) {
    const segments = line.slice(1).map((b, k) => ({ a: line[k], b, ...measure(line[k], b) }))
    segments.forEach((s, k) => {
      if (s.length <= 0.2) return
      const pieces = Math.ceil(s.length / LONGEST_PIECE)
      for (let i = 0; i < pieces; i++) {
        const t = (i + 0.5) / pieces
        const lng = s.a[0] + (s.b[0] - s.a[0]) * t
        const lat = s.a[1] + (s.b[1] - s.a[1]) * t
        if (inside(bounds, lng, lat))
          out.push({ lng, lat, model: spec.span, bearing: s.bearing, length: s.length / pieces, seed: k })
      }
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
    ...(span ? { length: p.length, conform: true as const } : {}),
    heading: bearingOf((p.bearing + 90) % 360)!,
    shade: 0.92 + cellHash(p.seed, Math.round(p.lng * 1e5), 1) * 0.12,
    model: p.model,
  }
}

const current = new WeakMap<object, Placement[]>()

let power = new Map<string, PowerPlacement[]>()

function placementsOf(feature: any): Placement[] | PowerPlacement[] {
  if (POWER_KINDS.has(feature.properties?.kind)) return power.get(pieceKey(feature)) ?? []
  let placed = current.get(feature)
  if (!placed) {
    placed = placeLine(feature.properties?.kind, feature.geometry, tileBounds(feature))
    current.set(feature, placed)
  }
  return placed
}

function powerIn(map: any): any[] {
  try {
    return map.querySourceFeatures(DETAIL_SOURCE, {
      sourceLayer: OBJECT_LINE_TILES,
      filter: ['in', ['get', 'kind'], ['literal', [...POWER_KINDS]]],
    })
  } catch {
    return []
  }
}

export const LINE_OBJECTS: ObjectSourceSpec = {
  source: DETAIL_SOURCE,
  sourceLayer: OBJECT_LINE_TILES,
  minzoom: 16,
  distinct: false,
  budget: 8000,
  prepare: map => { power = powerNetwork(powerIn(map)) },
  positions: feature => placementsOf(feature).map(p => [p.lng, p.lat] as [number, number]),
  toInstance(feature, _lng, _lat, index) {
    const p = placementsOf(feature)[index]
    if (!p) return null
    return 'seed' in p ? lineInstance(feature.properties.kind, feature.properties.height, p) : powerInstance(p)
  },
}
