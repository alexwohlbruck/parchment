// Lane-level geometry for driven segments: the request barrelman's
// /route/lanes takes, built from what a segment already carries, and its answer
// put back on the segment. Pure; the call itself is routingService.getLanes.

import type {
  Coordinate,
  DrivingSide,
  InstructionLanePlan,
  LaneArrow,
  LaneGeometry,
  LanesProfile,
  RouteEdgeSegment,
  RouteInstruction,
  RouteLanes,
  RouteLanesRequest,
} from '../types/unified-routing.types'

export interface LanedSegment {
  mode: string
  geometry?: Coordinate[] | null
  instructions?: RouteInstruction[]
  edgeSegments?: RouteEdgeSegment[]
  drivingSide?: DrivingSide
  laneGeometry?: LaneGeometry
  lanePlan?: InstructionLanePlan[]
}

/** Countries that drive on the left, as ISO 3166-1 alpha-3. */
const LEFT_HAND = new Set([
  'AIA', 'ATG', 'AUS', 'BGD', 'BHS', 'BMU', 'BRB', 'BRN', 'BTN', 'BWA', 'CCK', 'COK', 'CXR', 'CYM', 'CYP',
  'DMA', 'FJI', 'FLK', 'GBR', 'GGY', 'GRD', 'GUY', 'HKG', 'IDN', 'IMN', 'IND', 'IRL', 'JAM', 'JEY', 'JPN',
  'KEN', 'KIR', 'KNA', 'LCA', 'LKA', 'LSO', 'MAC', 'MDV', 'MLT', 'MOZ', 'MSR', 'MUS', 'MWI', 'MYS', 'NAM',
  'NFK', 'NIU', 'NPL', 'NRU', 'NZL', 'PAK', 'PCN', 'PNG', 'SGP', 'SHN', 'SLB', 'SUR', 'SWZ', 'SYC', 'TCA',
  'THA', 'TKL', 'TLS', 'TON', 'TTO', 'TUV', 'TZA', 'UGA', 'VCT', 'VGB', 'VIR', 'WSM', 'ZAF', 'ZMB', 'ZWE',
])

export function drivingSideFor(country: string | undefined): DrivingSide {
  return country && LEFT_HAND.has(country.toUpperCase()) ? 'left' : 'right'
}

/** The country most of a segment drives through. */
export function segmentCountry(edges: RouteEdgeSegment[] | undefined): string | undefined {
  const metres = new Map<string, number>()
  for (const e of edges ?? []) {
    if (e.country) metres.set(e.country, (metres.get(e.country) ?? 0) + e.endDistance - e.startDistance)
  }
  return [...metres].sort((a, b) => b[1] - a[1])[0]?.[0]
}

const TURNS: Record<string, string> = {
  left: 'left',
  right: 'right',
  'slight-left': 'slight_left',
  'slight-right': 'slight_right',
  'sharp-left': 'sharp_left',
  'sharp-right': 'sharp_right',
  straight: 'through',
  'u-turn': 'reverse',
}

const R = 6371000
function haversine(a: Coordinate, b: Coordinate): number {
  const toRad = Math.PI / 180
  const dLat = (b.lat - a.lat) * toRad
  const dLng = (b.lng - a.lng) * toRad
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

/** The modes drawn in their lanes, as barrelman's lane profiles; planned trips say biking, reroutes cycling. */
const LANE_PROFILES: Record<string, LanesProfile> = { driving: 'car', biking: 'bike', cycling: 'bike' }

export function lanesProfile(mode: string): LanesProfile | undefined {
  return LANE_PROFILES[mode]
}

/**
 * What /route/lanes needs for a driven or ridden segment, or null when its
 * edges carry no way ids (a graph built without osm_way_id).
 */
export function lanesRequest(segment: LanedSegment): RouteLanesRequest | null {
  const geometry = segment.geometry ?? []
  const profile = lanesProfile(segment.mode)
  const ways = (segment.edgeSegments ?? [])
    .filter((e): e is RouteEdgeSegment & { osmWayId: number } => e.osmWayId != null)
    .map(e => ({ from: e.startDistance, to: e.endDistance, osmWayId: e.osmWayId }))
  if (!profile || geometry.length < 2 || ways.length === 0) return null

  const cumulative = [0]
  for (let i = 1; i < geometry.length; i++) cumulative.push(cumulative[i - 1] + haversine(geometry[i - 1], geometry[i]))
  // Each instruction stands at a vertex of the geometry; find it in order.
  let from = 0
  const maneuvers = (segment.instructions ?? []).map(instruction => {
    const c = instruction.coordinate
    const i = geometry.findIndex((p, k) => k >= from && p.lat === c.lat && p.lng === c.lng)
    if (i >= 0) from = i
    const turn = instruction.type === 'turn' || instruction.type === 'continue' ? TURNS[instruction.modifier ?? ''] : undefined
    return { distance: cumulative[Math.max(0, i >= 0 ? i : from)], ...(turn && { turn }) }
  })

  const country = segmentCountry(segment.edgeSegments)
  return {
    coordinates: geometry.map(p => [p.lng, p.lat]),
    ways,
    maneuvers,
    profile,
    ...(country && { country }),
  }
}

const ARROWS: Record<string, LaneArrow> = {
  left: 'left',
  sharp_left: 'left',
  slight_left: 'slight-left',
  through: 'through',
  merge_to_left: 'through',
  merge_to_right: 'through',
  slight_right: 'slight-right',
  right: 'right',
  sharp_right: 'right',
  reverse: 'uturn',
}

/** turn:lanes values as the arrows a lane strip draws; an unmarked lane goes straight on. */
export function laneArrows(turns: string[]): LaneArrow[] {
  const arrows = [...new Set(turns.map(t => ARROWS[t]).filter((a): a is LaneArrow => !!a))]
  return arrows.length ? arrows : ['through']
}

/** Puts barrelman's lanes on the segment. */
export function applyLanes(segment: LanedSegment, lanes: RouteLanes): void {
  segment.drivingSide = lanes.drivingSide
  if (lanes.laneGeometry && lanes.laneGeometry.coordinates.length >= 2) {
    segment.laneGeometry = { coordinates: lanes.laneGeometry.coordinates, measures: lanes.laneGeometry.measures }
  }
  if (lanes.lanePlan.length && segment.mode === 'driving') {
    segment.lanePlan = lanes.lanePlan.map(p => ({
      instruction: p.maneuver,
      lanes: p.lanes.map(l => ({ arrows: laneArrows(l.turns), valid: l.valid, recommended: l.recommended })),
    }))
  }
}
