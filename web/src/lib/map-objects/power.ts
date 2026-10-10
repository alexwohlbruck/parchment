/**
 * Power lines from barrelman's `object_lines`: a tower, gantry or pole at every
 * vertex, and one conductor per phase strung from crossarm to crossarm.
 *
 * Each conductor is its own instance running between the two attachment points
 * it hangs from, so a line stays joined through a bend and between structures
 * of different heights.
 */
import type { ObjectInstance } from './object-layer'
import { bearingOf } from './furniture'
import { cellHash } from './planting'
import { METRES_PER_DEGREE, between, measure, stitch, type LineNode } from './tile-lines'
import STRUCTURES from './power-structures.json'

export const POWER_MODELS = {
  'power-tower': '/models/power-tower.glb',
  'power-portal': '/models/power-portal.glb',
  'power-pole': '/models/power-pole.glb',
  'power-conductor': '/models/power-conductor.glb',
  'power-busbar': '/models/power-busbar.glb',
  'pole-conductor': '/models/pole-conductor.glb',
}

type Structure = keyof typeof STRUCTURES
type Conductor = 'power-conductor' | 'power-busbar' | 'pole-conductor'

export const CONDUCTORS: Conductor[] = ['power-conductor', 'power-busbar', 'pole-conductor']

export const POWER_KINDS = new Set(['power_line', 'power_minor_line'])

/** Transmission spans this short are inside a substation, held by gantries and strung taut. */
export const SUBSTATION_SPAN = 80

export type PowerPlacement =
  | { model: Structure; lng: number; lat: number; bearing: number }
  | { model: Conductor; lng: number; lat: number; bearing: number; length: number; height: number; rise: number }

type Arm = { bearing: number; length: number; kind: string }

type Standing = { model: Structure; bearing: number }

type Attachment = { lng: number; lat: number; height: number; side: number }

/** The bearing a structure holds its line along: through the two arms nearest to opposite. */
function axisOf(arms: Arm[]): number {
  if (arms.length === 1) return arms[0].bearing
  let pair = [arms[0].bearing, arms[1].bearing]
  let straightest = Infinity
  arms.forEach((a, i) =>
    arms.slice(i + 1).forEach(b => {
      const turn = Math.cos(((a.bearing - b.bearing) * Math.PI) / 180)
      if (turn < straightest) [straightest, pair] = [turn, [a.bearing, b.bearing]]
    }),
  )
  return between(pair[1], pair[0] + 180)
}

function structureFor(arms: Arm[]): Structure {
  if (!arms.some(a => a.kind === 'power_line')) return 'power-pole'
  return Math.max(...arms.map(a => a.length)) < SUBSTATION_SPAN ? 'power-portal' : 'power-tower'
}

/** Where a structure holds its phases, with `side` measured to the left of a span leaving along `travel`. */
function attachments(node: LineNode, { model, bearing }: Standing, travel: number): Attachment[] {
  const facing = Math.cos(((bearing - travel) * Math.PI) / 180) < 0 ? bearing + 180 : bearing
  const r = (facing * Math.PI) / 180
  const k = Math.cos((node.lat * Math.PI) / 180) * METRES_PER_DEGREE
  return STRUCTURES[model].phases.map(([height, side]) => ({
    lng: node.lng - (Math.cos(r) * side) / k,
    lat: node.lat + (Math.sin(r) * side) / METRES_PER_DEGREE,
    height,
    side,
  }))
}

/** Pairs each phase on the busier structure with the one across the other that sits nearest its place in the row. */
function pairs(from: Attachment[], to: Attachment[]): Array<[Attachment, Attachment]> {
  const row = (list: Attachment[]) => {
    const reach = Math.max(...list.map(a => Math.abs(a.side))) || 1
    return list.map(a => ({ a, at: a.side / reach }))
  }
  const nearest = (at: number, list: ReturnType<typeof row>) =>
    list.reduce((best, x) => (Math.abs(x.at - at) < Math.abs(best.at - at) ? x : best)).a
  const [f, t] = [row(from), row(to)]
  return f.length >= t.length ? f.map(x => [x.a, nearest(x.at, t)]) : t.map(x => [nearest(x.at, f), x.a])
}

function conductorFor(kind: string, length: number): Conductor {
  if (kind !== 'power_line') return 'pole-conductor'
  return length < SUBSTATION_SPAN ? 'power-busbar' : 'power-conductor'
}

/**
 * Every structure and conductor the loaded tiles hold, filed under the tile
 * piece that places it, so each is drawn once however many tiles the line crosses.
 */
export function powerNetwork(features: any[]): Map<string, PowerPlacement[]> {
  const edges = stitch(features).map(e => ({ ...e, ...measure([e.from.lng, e.from.lat], [e.to.lng, e.to.lat]) }))
    .filter(e => e.length > 0.2)
  const arms = new Map<LineNode, Arm[]>()
  const arm = (node: LineNode, a: Arm) => {
    const list = arms.get(node)
    if (list) list.push(a)
    else arms.set(node, [a])
  }
  for (const e of edges) {
    arm(e.from, { bearing: e.bearing, length: e.length, kind: e.kind })
    arm(e.to, { bearing: (e.bearing + 180) % 360, length: e.length, kind: e.kind })
  }

  const out = new Map<string, PowerPlacement[]>()
  const place = (piece: string, p: PowerPlacement) => {
    const list = out.get(piece)
    if (list) list.push(p)
    else out.set(piece, [p])
  }
  const standing = new Map<LineNode, Standing>()
  for (const [node, list] of arms) {
    const s = { model: structureFor(list), bearing: axisOf(list) }
    standing.set(node, s)
    place(node.piece, { ...s, lng: node.lng, lat: node.lat })
  }
  for (const e of edges) {
    const from = attachments(e.from, standing.get(e.from)!, e.bearing)
    const to = attachments(e.to, standing.get(e.to)!, e.bearing)
    const model = conductorFor(e.kind, e.length)
    for (const [a, b] of pairs(from, to)) {
      const { bearing, length } = measure([a.lng, a.lat], [b.lng, b.lat])
      place(e.from.piece, {
        model,
        lng: (a.lng + b.lng) / 2,
        lat: (a.lat + b.lat) / 2,
        bearing,
        length,
        height: (a.height + b.height) / 2,
        rise: b.height - a.height,
      })
    }
  }
  return out
}

export function powerInstance(p: PowerPlacement): ObjectInstance {
  const heading = bearingOf((p.bearing + 90) % 360)!
  if ('length' in p)
    return { lng: p.lng, lat: p.lat, height: p.height, spread: p.height, length: p.length, rise: p.rise, conform: true, heading, shade: 1, model: p.model }
  const { height } = STRUCTURES[p.model]
  const shade = 0.94 + cellHash(Math.round(p.lng * 1e5), Math.round(p.lat * 1e5), 1) * 0.1
  return { lng: p.lng, lat: p.lat, height, spread: height, heading, shade, model: p.model }
}
