// A street-level leg as the runs a traveller remembers — one street or path each — rather than the router's every turn.

import { getStressCategory, type ProfileCategory } from './route-profile-colors'
import type { RouteEdgeSegment, RouteInstruction } from '@/types/directions.types'

/** Pieces shorter than this are a jog across a junction, folded into the stretch before them. */
export const JOG_METERS = 30
/** Pieces shorter than this are a connector between stretches rather than a stretch of their own. */
export const MIN_STRETCH_METERS = 75
/** An average grade this steep, held for this long, is worth naming on the stretch. */
const CLIMB_PERCENT = 4
const CLIMB_METERS = 100

export type StretchSurface = 'steps' | 'protected' | 'lane' | 'path' | 'quiet' | 'road' | 'unknown'

export interface Stretch {
  /** The street or path's name, or null when the way has none. */
  name: string | null
  /** Metres from the segment's start. */
  from: number
  to: number
  /** The router's instructions this stretch covers, by index. */
  instructions: number[]
  /** The maneuvers that leave this stretch for the next one, including any jogs folded in between. */
  exits: RouteInstruction[]
  surface: StretchSurface
  /** Bike-friendliness, for cycling legs with priority data. */
  quality: ProfileCategory | null
  /** Average uphill grade in percent, when the stretch holds a real climb. */
  climb: number | null
}

interface Piece {
  name: string | null
  key: string | null
  from: number
  to: number
  instructions: number[]
  /** Leads of the short pieces folded onto this one's end: turns out of it. */
  absorbed: number[]
}

const DIRECTION_PREFIX = /^(north|south|east|west|n|s|e|w)\.?\s+/i

/** "South Davidson Street" and "North Davidson Street" are one street to someone riding it. */
export function streetKey(name: string): string {
  return name.replace(DIRECTION_PREFIX, '').trim().toLowerCase()
}

function joined(a: Piece, b: Piece): Piece {
  const name = a.name && b.name && a.name !== b.name ? a.name.replace(DIRECTION_PREFIX, '') : a.name ?? b.name
  // Turns folded into `a` led back onto the same street, so they're a jog within it, not a way out.
  return { name, key: a.key, from: a.from, to: b.to, instructions: [...a.instructions, ...b.instructions], absorbed: b.absorbed }
}

function piecesOf(instructions: RouteInstruction[]): Piece[] {
  const pieces: Piece[] = []
  let offset = 0
  instructions.forEach((instruction, index) => {
    const distance = instruction.distance ?? 0
    if (distance <= 0 && index === instructions.length - 1) return
    const name = instruction.streetName || instruction.streetRef || null
    pieces.push({ name, key: name ? streetKey(name) : null, from: offset, to: offset + distance, instructions: [index], absorbed: [] })
    offset += distance
  })
  return pieces
}

function joinSameStreet(pieces: Piece[]): Piece[] {
  const out: Piece[] = []
  for (const piece of pieces) {
    const last = out.at(-1)
    if (last && last.key === piece.key) out[out.length - 1] = joined(last, piece)
    else out.push(piece)
  }
  return out
}

/** Folds every piece shorter than `meters` into a neighbour, shortest first, rejoining same-street runs as it goes. */
function foldShort(pieces: Piece[], meters: number): Piece[] {
  let list = joinSameStreet(pieces)
  const length = (p: Piece) => p.to - p.from
  for (;;) {
    let shortest = -1
    list.forEach((piece, i) => {
      if (list.length > 1 && length(piece) < meters && (shortest < 0 || length(piece) < length(list[shortest]))) shortest = i
    })
    if (shortest < 0) return list
    const next = [...list]
    const short = next[shortest]
    if (shortest === 0) {
      const after = next[1]
      next.splice(0, 2, { ...after, from: short.from, instructions: [...short.instructions, ...after.instructions] })
    } else {
      const before = next[shortest - 1]
      next.splice(shortest - 1, 2, {
        ...before,
        to: short.to,
        instructions: [...before.instructions, ...short.instructions],
        absorbed: [...before.absorbed, short.instructions[0], ...short.absorbed],
      })
    }
    list = joinSameStreet(next)
  }
}

export function edgeSurface(edge: RouteEdgeSegment): StretchSurface {
  const road = edge.roadClass ?? ''
  if (road === 'steps') return 'steps'
  if (road === 'cycleway' || edge.cycleway === 'track' || edge.cycleway === 'separate') return 'protected'
  if (edge.cycleway === 'lane' || edge.cycleLane === 'dedicated') return 'lane'
  if (['path', 'footway', 'pedestrian', 'track', 'bridleway'].includes(road)) return 'path'
  if (['residential', 'living_street', 'service', 'unclassified'].includes(road)) return 'quiet'
  if (/^(tertiary|secondary|primary|trunk|motorway)/.test(road)) return 'road'
  return 'unknown'
}

function overlap(edge: RouteEdgeSegment, from: number, to: number): number {
  return Math.max(0, Math.min(edge.endDistance, to) - Math.max(edge.startDistance, from))
}

function describe(piece: Piece, edges: RouteEdgeSegment[], cycling: boolean): Pick<Stretch, 'surface' | 'quality' | 'climb'> {
  const bySurface = new Map<StretchSurface, number>()
  let priority = 0
  let priorityLength = 0
  let rise = 0
  let length = 0
  for (const edge of edges) {
    const meters = overlap(edge, piece.from, piece.to)
    if (!meters) continue
    const surface = edgeSurface(edge)
    bySurface.set(surface, (bySurface.get(surface) ?? 0) + meters)
    if (edge.bikePriority != null) {
      priority += (edge.getOffBike ? 0 : edge.bikePriority) * meters
      priorityLength += meters
    }
    if (edge.averageSlope != null) rise += Math.max(0, edge.averageSlope) * meters
    length += meters
  }
  const surface = [...bySurface.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown'
  const grade = length >= CLIMB_METERS ? rise / length : 0
  return {
    surface,
    quality: cycling && priorityLength ? getStressCategory(priority / priorityLength, false) : null,
    climb: grade >= CLIMB_PERCENT ? Math.round(grade) : null,
  }
}

export interface StretchSource {
  mode?: string
  instructions?: (RouteInstruction | string)[]
  edgeSegments?: RouteEdgeSegment[]
}

export function legStretches(segment: StretchSource): Stretch[] {
  const instructions = (segment.instructions ?? []).filter((i): i is RouteInstruction => typeof i === 'object')
  if (!instructions.length) return []
  const cycling = segment.mode === 'cycling' || segment.mode === 'biking'
  const edges = segment.edgeSegments ?? []
  const folded = foldShort(foldShort(piecesOf(instructions), JOG_METERS), MIN_STRETCH_METERS)
  return folded.map((piece, i) => {
    const next = folded[i + 1]
    const exits = [...piece.absorbed, ...(next ? [next.instructions[0]] : [])].map(index => instructions[index])
    return { name: piece.name, from: piece.from, to: piece.to, instructions: piece.instructions, exits, ...describe(piece, edges, cycling) }
  })
}

/** Share of a cycling leg's distance on ways rated friendly or better, 0–1, or null without priority data. */
export function friendlyShare(segment: StretchSource): number | null {
  let friendly = 0
  let total = 0
  for (const edge of segment.edgeSegments ?? []) {
    if (edge.bikePriority == null) continue
    const meters = edge.endDistance - edge.startDistance
    const group = getStressCategory(edge.bikePriority, edge.getOffBike).group
    if (group === 'high' || group === 'very_high') friendly += meters
    total += meters
  }
  return total ? friendly / total : null
}

/** Which stretch `offset` metres into the leg falls on. */
export function stretchAt(stretches: Stretch[], offset: number): number {
  const index = stretches.findIndex(s => offset < s.to)
  return index < 0 ? stretches.length - 1 : index
}
