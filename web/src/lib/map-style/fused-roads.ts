/**
 * The road network's three rungs, drawn as one layer per part instead of three.
 *
 * Each layer costs a draw call per tile, and the basemap splits every road part
 * by class: `Minor road`, `Major road` and `Highway`, again as casings, again on
 * bridges. The rungs differ only in which features they take and how those are
 * painted, both of which a single layer can carry per feature, while
 * `line-sort-key` keeps a highway over the street it crosses.
 */
import { latest } from '@maplibre/maplibre-gl-style-spec'
import { combineFilters } from './combine-filters'
import { CYCLING_SUFFIX } from './cycling.mjs'
import { CYCLING_WAYS_SUFFIX } from './cycling-layers'

/** Smallest first, which is also the order they stack in. */
const RUNGS = ['Minor road', 'Major road', 'Highway']
const PARTS = [' outline', '', ' outline bridge', ' bridge']
const TWINS = ['', CYCLING_SUFFIX, CYCLING_WAYS_SUFFIX]

const GROUPS = PARTS.flatMap(part => TWINS.map(twin => ({
  id: `Road${part}${twin}`,
  members: RUNGS.map(rung => `${rung}${part}${twin}`),
})))

const FUSED_ID = new Map(GROUPS.flatMap(g => g.members.map(m => [m, g.id])))

/** The id a rung's layer is drawn under once fused. */
export const fusedRoadId = (id: string) => FUSED_ID.get(id) ?? id

type Layer = Record<string, any>
type Stop = [number, unknown]

const isZoomCurve = (v: unknown): v is any[] =>
  Array.isArray(v) && v[0] === 'interpolate' && Array.isArray(v[2]) && v[2][0] === 'zoom'

const mentionsZoom = (v: unknown) => JSON.stringify(v ?? null).includes('["zoom"]')

const stopsOf = (curve: any[]): Stop[] => {
  const out: Stop[] = []
  for (let i = 3; i < curve.length; i += 2) out.push([curve[i], curve[i + 1]])
  return out
}

/** A linear curve's value at `z`, which an extra stop then reproduces exactly. */
function linearAt(stops: Stop[], z: number): unknown {
  const after = stops.findIndex(([at]) => at >= z)
  if (after === 0) return stops[0][1]
  if (after < 0) return stops[stops.length - 1][1]
  const [[a, va], [b, vb]] = [stops[after - 1], stops[after]]
  if (b === z) return vb
  const t = (z - a) / (b - a)
  if (typeof va === 'number' && typeof vb === 'number') return va + t * (vb - va)
  return ['+', ['*', 1 - t, va], ['*', t, vb]]
}

/** The members' values as one, picked by the first filter a feature passes. */
function caseOf(values: unknown[], when: unknown[]): unknown {
  const same = values.every(v => JSON.stringify(v) === JSON.stringify(values[0]))
  if (same) return values[0]
  return ['case', ...values.slice(0, -1).flatMap((v, i) => [when[i], v]), values[values.length - 1]]
}

/** One property for every member, or `undefined` if the members can't share it. */
function mergeProperty(values: unknown[], when: unknown[]): unknown {
  const curves = values.filter(isZoomCurve)
  if (!curves.length) return values.some(mentionsZoom) ? undefined : caseOf(values, when)
  if (values.some(v => !isZoomCurve(v) && mentionsZoom(v))) return undefined

  const kind = JSON.stringify(curves[0][1])
  if (curves.some(c => JSON.stringify(c[1]) !== kind)) return undefined
  const zooms = [...new Set(curves.flatMap(c => stopsOf(c).map(([z]) => z)))].sort((a, b) => a - b)
  const sharedStops = curves.every(c => stopsOf(c).length === zooms.length)
  if (!sharedStops && curves[0][1][0] !== 'linear') return undefined

  const at = (v: unknown, z: number) => (isZoomCurve(v) ? linearAt(stopsOf(v), z) : v)
  const outputs = zooms.map(z => caseOf(values.map(v => at(v, z)), when))
  if (outputs.some(mentionsZoom)) return undefined
  return [...curves[0].slice(0, 3), ...zooms.flatMap((z, i) => [z, outputs[i]])]
}

function mergeBlock(block: 'paint' | 'layout', members: Layer[], when: unknown[]): Layer | null {
  const type = members[0].type
  const spec = (latest as any)[`${block}_${type}`] ?? {}
  const keys = new Set(members.flatMap(m => Object.keys(m[block] ?? {})))
  const out: Layer = {}
  for (const key of keys) {
    const values = members.map(m => m[block]?.[key] ?? spec[key]?.default)
    if (values.every(v => JSON.stringify(v) === JSON.stringify(values[0]))) {
      out[key] = values[0]
      continue
    }
    if (spec[key]?.['property-type'] !== 'data-driven') return null
    const merged = mergeProperty(values, when)
    if (merged === undefined) return null
    out[key] = merged
  }
  return out
}

/** The members drawn as one layer, or `null` when something they set can't vary per feature. */
export function fuseLayers(id: string, members: Layer[]): Layer | null {
  const [first] = members
  const alike = (key: string) => members.every(m => m[key] === first[key])
  if (!['type', 'source', 'source-layer', 'minzoom', 'maxzoom'].every(alike)) return null
  if (first.type !== 'line' || members.some(m => m.layout?.['line-sort-key'] !== undefined)) return null

  const when = members.map(m => combineFilters([m.filter]) ?? true)
  const layout = mergeBlock('layout', members, when)
  const paint = mergeBlock('paint', members, when)
  if (!layout || !paint) return null

  return {
    ...first,
    id,
    filter: ['any', ...when],
    layout: { ...layout, 'line-sort-key': caseOf(members.map((_, i) => i), when) },
    paint,
  }
}

/** Each group of rungs replaced by its fused layer, drawn where the group's first rung was. */
export function fuseRoadRungs<T>(layers: T[]): T[] {
  let out = layers as Layer[]
  for (const { id, members } of GROUPS) {
    const found = members.map(m => out.find(l => l.id === m))
    if (found.some(l => !l)) continue
    const fused = fuseLayers(id, found as Layer[])
    if (!fused) continue
    const at = out.indexOf(found[0]!)
    out = out.flatMap((l, i) => (i === at ? [fused] : members.includes(l.id) ? [] : [l]))
  }
  return out as T[]
}
