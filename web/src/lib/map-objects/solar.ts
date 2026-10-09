/**
 * Ground-mounted solar arrays from barrelman's `object_areas`, as east-west
 * rows of panels facing the equator: a row is a few stretched slabs, short
 * enough to follow the terrain, so a field costs a few hundred 12-triangle instances.
 */
import { DETAIL_SOURCE, OBJECT_AREA_TILES } from '@/lib/map-style/detail-layers'
import type { ObjectInstance, ObjectSourceSpec } from './object-layer'
import { bearingOf } from './furniture'
import { MERCATOR_METRE, pieceKey, polygonsOf, spansAt, tileBounds, type Bounds } from './planting'

export const SOLAR_MODELS = {
  'solar-row': '/models/solar-row.glb',
}

/** Row pitch, longest slab and end inset, in mercator metres. */
const PITCH = 8
const SEGMENT = 24
const INSET = 1
const SHORTEST = 3

const EARTH_CIRCUMFERENCE = 2 * Math.PI * 6371008.8

/** A row slab: its centre and its length in metres. */
export type SolarRow = { lng: number; lat: number; length: number }

const lngOf = (x: number) => x * 360 - 180
const latOf = (y: number) => (360 / Math.PI) * Math.atan(Math.exp((1 - 2 * y) * Math.PI)) - 90

/**
 * Rows across a polygon on a world-anchored pitch, clipped to `bounds` so a
 * polygon split across tiles is laid once.
 */
export function solarRows(geometry: any, bounds: Bounds): SolarRow[] {
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
        const x0 = Math.max(a + inset, bounds.minX)
        const x1 = Math.min(b - inset, bounds.maxX)
        if ((x1 - x0) / MERCATOR_METRE < SHORTEST) continue
        const n = Math.ceil((x1 - x0) / segment)
        const step = (x1 - x0) / n
        for (let k = 0; k < n; k++)
          out.push({ lng: lngOf(x0 + (k + 0.5) * step), lat, length: step * metres })
      }
    }
  }
  return out
}

/** Toward the equator, whichever hemisphere it is in. */
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
  }
}

function solarSpec(): ObjectSourceSpec {
  const laid = new Map<string, SolarRow[]>()
  const rowsOf = (feature: any): SolarRow[] => {
    if (feature.properties?.kind !== 'solar') return []
    const tile = tileBounds(feature)
    if (!tile) return []
    const key = pieceKey(feature)
    let rows = laid.get(key)
    if (!rows) {
      rows = solarRows(feature.geometry, tile)
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
    budget: 1000,
    positions: feature => rowsOf(feature).map(r => [r.lng, r.lat] as [number, number]),
    toInstance: (feature, _lng, _lat, index) => {
      const row = rowsOf(feature)[index]
      return row ? solarRow(row) : null
    },
  }
}

export const SOLAR_OBJECTS = solarSpec()
