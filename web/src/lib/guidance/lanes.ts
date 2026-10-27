// Which lanes lead where at an upcoming turn, read from the turn arrows painted
// on the approach (the basemap's road glyphs, from OSM turn:lanes).

import type { LngLat } from '@/types/map.types'
import type { LaneArrow, LanePlan } from '@server/types/unified-routing.types'
import type { ManeuverKind } from '@/lib/directions/maneuver'
import { angleDelta } from './spring'

export type { Lane, LaneArrow, LanePlan } from '@server/types/unified-routing.types'

export interface RoadGlyph {
  glyph: string
  /** Compass bearing the arrow reads along. */
  direction: number
  position: LngLat
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
/** One row of arrows: painted this close along the road, facing the same way. */
const ROW_DEPTH_METERS = 6
const ROW_HEADING_DEG = 10
const METERS_PER_DEGREE = 111_320

/**
 * The arrows a maneuver can use, best first: a lane leads on when it has an
 * arrow from the first group any lane has. A bend onto the road ahead uses the
 * through lanes, not the ones turning off.
 */
export function laneArrowTiers(kind: ManeuverKind): LaneArrow[][] {
  switch (kind) {
    case 'left':
    case 'sharp-left':
      return [['left']]
    case 'right':
    case 'sharp-right':
      return [['right']]
    case 'slight-left':
      return [['slight-left'], ['through'], ['left']]
    case 'slight-right':
      return [['slight-right'], ['through'], ['right']]
    case 'keep-left':
      return [['slight-left', 'left'], ['through']]
    case 'keep-right':
      return [['slight-right', 'right'], ['through']]
    case 'uturn':
      return [['uturn', 'left']]
    default:
      return [['through']]
  }
}

/** The arrows of `lane` that the best group it shares with the maneuver names. */
export function arrowsUsed(arrows: LaneArrow[], kind: ManeuverKind): LaneArrow[] {
  const tier = laneArrowTiers(kind).find(t => arrows.some(a => t.includes(a)))
  return tier ? arrows.filter(a => tier.includes(a)) : []
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

  // The row nearest the stop line only: a divided crossroad paints a second
  // row, at another angle, that must not fill in this one's lanes.
  const first = near[0]
  if (!first) return null
  const row = near.filter(
    g => first.along - g.along <= ROW_DEPTH_METERS && Math.abs(angleDelta(g.glyph.direction, first.glyph.direction)) <= ROW_HEADING_DEG,
  )
  const lanes: typeof near = []
  for (const g of row) {
    if (!lanes.some(l => Math.abs(l.across - g.across) < SAME_LANE_METERS)) lanes.push(g)
  }
  if (lanes.length < 2) return null
  lanes.sort((a, b) => a.across - b.across)

  const tier = laneArrowTiers(kind).find(t => lanes.some(l => ARROWS[l.glyph.glyph].some(a => t.includes(a))))
  if (!tier) return null
  const plan = lanes.map(l => {
    const arrows = ARROWS[l.glyph.glyph]
    return { arrows, valid: arrows.some(a => tier.includes(a)), recommended: false }
  })
  const valid = plan.map((l, i) => (l.valid ? i : -1)).filter(i => i >= 0)
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
