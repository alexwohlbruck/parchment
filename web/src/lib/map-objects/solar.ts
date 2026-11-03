/**
 * Ground-mounted solar arrays from barrelman's `object_areas`, as east-west
 * rows of panels facing the equator: a row is a few stretched slabs, short
 * enough to follow the terrain, so a field costs a few hundred 12-triangle instances.
 */
import { DETAIL_SOURCE, OBJECT_AREA_TILES } from '@/lib/map-style/detail-layers'
import type { ObjectInstance, ObjectSourceSpec } from './object-layer'
import { bearingOf } from './furniture'
import {
  MERCATOR_METRE,
  blockedAlong,
  builtExclusionsFor,
  pieceKey,
  polygonsOf,
  spansAt,
  tileBounds,
  type Bounds,
  type ForestExclusions,
} from './planting'

export const SOLAR_MODELS = {
  'solar-row': '/models/solar-row.glb',
}

/** Row pitch, longest slab, end inset, shortest slab and half a row's depth, in mercator metres. */
const PITCH = 8
const SEGMENT = 24
const INSET = 1
const SHORTEST = 3
const ROW_HALF_DEPTH = 1.5

const EARTH_CIRCUMFERENCE = 2 * Math.PI * 6371008.8

/** A row slab: its centre and its length in metres. */
export type SolarRow = { lng: number; lat: number; length: number }

const lngOf = (x: number) => x * 360 - 180
const latOf = (y: number) => (360 / Math.PI) * Math.atan(Math.exp((1 - 2 * y) * Math.PI)) - 90

/** The stretches of `[x0, x1]` at height `y` that stay clear of every exclusion. */
function clearRuns(x0: number, x1: number, y: number, ex: ForestExclusions | null): Array<[number, number]> {
  if (!ex) return [[x0, x1]]
  const runs: Array<[number, number]> = []
  let from = x0
  for (const [a, b] of blockedAlong(ex, y, x0, x1, ROW_HALF_DEPTH * MERCATOR_METRE)) {
    if (a > from) runs.push([from, Math.min(a, x1)])
    from = Math.max(from, b)
    if (from >= x1) break
  }
  if (from < x1) runs.push([from, x1])
  return runs
}

/**
 * Rows across a polygon on a world-anchored pitch, clipped to `bounds` so a
 * polygon split across tiles is laid once, and broken around `exclusions`.
 */
export function solarRows(geometry: any, bounds: Bounds, exclusions: ForestExclusions | null = null): SolarRow[] {
  const [pitch, segment, inset] = [PITCH, SEGMENT, INSET].map(m => m * MERCATOR_METRE)
  const out: SolarRow[] = []
  for (const rings of polygonsOf(geometry)) {
    const ys = rings[0]?.map(p => p[1]) ?? []
    const j0 = Math.floor(Math.max(Math.min(...ys), bounds.minY) / pitch)
    const j1 = Math.floor(Math.min(Math.max(...ys), bounds.maxY) / pitch)
    for (let j = j0; j <= j1; j++) {
      const y = (j + 0.5) * pitch
      if (y < bounds.minY || y >= bounds.maxY) continue
      const lat = latOf(y)
      const metres = EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180)
      for (const [a, b] of spansAt(rings, y)) {
        const left = Math.max(a + inset, bounds.minX)
        const right = Math.min(b - inset, bounds.maxX)
        if (right <= left) continue
        for (const [x0, x1] of clearRuns(left, right, y, exclusions)) {
          if ((x1 - x0) / MERCATOR_METRE < SHORTEST) continue
          const n = Math.ceil((x1 - x0) / segment)
          const step = (x1 - x0) / n
          for (let k = 0; k < n; k++)
            out.push({ lng: lngOf(x0 + (k + 0.5) * step), lat, length: step * metres })
        }
      }
    }
  }
  return out
}

/** Toward the equator, whichever hemisphere it is in, tilted with the ground across a whole row pitch. */
export function solarRow(row: SolarRow): ObjectInstance {
  return {
    lng: row.lng,
    lat: row.lat,
    height: 2,
    spread: 2,
    length: row.length,
    heading: bearingOf(row.lat >= 0 ? 180 : 0)!,
    shade: 1,
    model: 'solar-row',
    conform: { across: PITCH },
  }
}

function solarSpec(): ObjectSourceSpec {
  const laid = new Map<string, SolarRow[]>()
  let map: any = null
  let exclusions: ForestExclusions | null = null
  const rowsOf = (feature: any): SolarRow[] => {
    if (feature.properties?.kind !== 'solar') return []
    const tile = tileBounds(feature)
    if (!tile) return []
    const key = pieceKey(feature)
    let rows = laid.get(key)
    if (!rows) {
      exclusions ??= map ? builtExclusionsFor(map) : null
      rows = solarRows(feature.geometry, tile, exclusions)
      if (laid.size >= 5000) laid.clear()
      laid.set(key, rows)
    }
    return rows
  }
  return {
    source: DETAIL_SOURCE,
    sourceLayer: OBJECT_AREA_TILES,
    minzoom: 17,
    distinct: false,
    followsView: true,
    budget: 5000,
    prepare(m) {
      map = m
      exclusions = null
    },
    positions: feature => rowsOf(feature).map(r => [r.lng, r.lat] as [number, number]),
    toInstance: (feature, _lng, _lat, index) => {
      const row = rowsOf(feature)[index]
      return row ? solarRow(row) : null
    },
  }
}

export const SOLAR_OBJECTS = solarSpec()
