// Which lanes lead where at an upcoming turn, read from the turn arrows painted
// on the approach (the basemap's road glyphs, from OSM turn:lanes).

import type { LngLat } from '@/types/map.types'
import type { ManeuverKind } from '@/lib/directions/maneuver'
import { angleDelta } from './spring'

export type LaneArrow = 'left' | 'slight-left' | 'through' | 'slight-right' | 'right' | 'uturn'

export interface RoadGlyph {
  glyph: string
  /** Compass bearing the arrow reads along. */
  direction: number
  position: LngLat
}

export interface Lane {
  arrows: LaneArrow[]
  valid: boolean
  recommended: boolean
}

export interface LanePlan {
  lanes: Lane[]
}

const ARROWS: Record<string, LaneArrow[]> = {
  'road-arrow-left': ['left'],
  'road-arrow-through': ['through'],
  'road-arrow-right': ['right'],
  'road-arrow-left-through': ['left', 'through'],
  'road-arrow-through-right': ['through', 'right'],
  'road-arrow-left-right': ['left', 'right'],
  'road-arrow-slight-left': ['slight-left'],
  'road-arrow-slight-right': ['slight-right'],
  'road-arrow-uturn': ['uturn'],
}

/** Arrows are painted this far back from the stop line, at most. */
const BEFORE_METERS = 90
const PAST_METERS = 8
const ACROSS_METERS = 14
const SAME_HEADING_DEG = 35
/** Arrows this close across the road are one lane. */
const SAME_LANE_METERS = 1.6
const METERS_PER_DEGREE = 111_320

/** What a maneuver needs a lane to allow. */
function needs(kind: ManeuverKind): LaneArrow[] {
  switch (kind) {
    case 'left':
    case 'sharp-left':
      return ['left']
    case 'right':
    case 'sharp-right':
      return ['right']
    case 'slight-left':
    case 'keep-left':
      return ['slight-left', 'left', 'through']
    case 'slight-right':
    case 'keep-right':
      return ['slight-right', 'right', 'through']
    case 'uturn':
      return ['uturn', 'left']
    default:
      return ['through']
  }
}

/** Metres along and across the approach heading, right positive. */
function frame(origin: LngLat, bearing: number, p: LngLat): { along: number; across: number } {
  const cos = Math.cos((origin.lat * Math.PI) / 180)
  const east = (p.lng - origin.lng) * cos * METERS_PER_DEGREE
  const north = (p.lat - origin.lat) * METERS_PER_DEGREE
  const rad = (bearing * Math.PI) / 180
  return {
    along: east * Math.sin(rad) + north * Math.cos(rad),
    across: east * Math.cos(rad) - north * Math.sin(rad),
  }
}

/**
 * The lanes on the approach to a maneuver at `at`, reached heading `bearing`,
 * or null where fewer than two lanes are painted with arrows.
 */
export function lanePlan(glyphs: RoadGlyph[], at: LngLat, bearing: number, kind: ManeuverKind): LanePlan | null {
  const near = glyphs
    .filter(g => ARROWS[g.glyph] && Math.abs(angleDelta(g.direction, bearing)) <= SAME_HEADING_DEG)
    .map(g => ({ glyph: g, ...frame(at, bearing, g.position) }))
    .filter(g => g.along <= PAST_METERS && g.along >= -BEFORE_METERS && Math.abs(g.across) <= ACROSS_METERS)
    .sort((a, b) => b.along - a.along)

  // The row nearest the stop line: one arrow per lane.
  const lanes: typeof near = []
  for (const g of near) {
    if (!lanes.some(l => Math.abs(l.across - g.across) < SAME_LANE_METERS)) lanes.push(g)
  }
  if (lanes.length < 2) return null
  lanes.sort((a, b) => a.across - b.across)

  const wanted = needs(kind)
  const plan = lanes.map(l => {
    const arrows = ARROWS[l.glyph.glyph]
    return { arrows, valid: arrows.some(a => wanted.includes(a)), recommended: false }
  })
  const valid = plan.map((l, i) => (l.valid ? i : -1)).filter(i => i >= 0)
  if (valid.length === 0) return null
  const pick = kind.includes('left') || kind === 'uturn' ? valid[0] : kind.includes('right') ? valid.at(-1)! : valid[Math.floor((valid.length - 1) / 2)]
  plan[pick].recommended = true
  return { lanes: plan }
}

/** "right two", "left", "middle": which lanes to use, when not all of them work. */
export function laneHint(plan: LanePlan): { side: 'left' | 'right' | 'middle'; count: number } | null {
  const valid = plan.lanes.map((l, i) => (l.valid ? i : -1)).filter(i => i >= 0)
  if (valid.length === plan.lanes.length) return null
  const count = valid.length
  if (valid[0] === 0) return { side: 'left', count }
  if (valid.at(-1) === plan.lanes.length - 1) return { side: 'right', count }
  return { side: 'middle', count }
}
