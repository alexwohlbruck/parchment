import { MIN_DISMOUNT_METERS } from '@/lib/guidance/hazards'
import type { RouteHazard, RouteHazardKind } from '@/types/directions.types'

/** What a leg's card warns about, by how the traveller moves. Lights, signs and ordinary crosswalks are just the city. */
const HEADS_UP: Record<string, RouteHazardKind[]> = {
  walking: ['steps', 'no_sidewalk', 'unlit', 'uncontrolled_crossing', 'rail_crossing', 'ford', 'flood_prone', 'steep_grade', 'hazard'],
  cycling: ['dismount', 'steep_grade', 'rail_crossing', 'tram_tracks', 'tram_crossing', 'rough_surface', 'bike_lane_end', 'steps', 'ford', 'unlit', 'hazard'],
  driving: ['toll', 'ferry', 'low_clearance', 'ford', 'movable_bridge', 'flood_prone', 'icy_bridge', 'school_zone', 'hazard'],
}

const SEVERITY = { high: 0, medium: 1, low: 2 } as const

export interface HeadsUp {
  kind: RouteHazardKind
  /** Metres into the leg of the first one. */
  at: number
  count: number
  severity: RouteHazard['severity']
}

interface HazardSource {
  mode?: string
  hazards?: RouteHazard[]
}

const pushed = (hazard: RouteHazard) => (hazard.endDistance ?? hazard.startDistance) - hazard.startDistance

/** Every hazard on the leg worth warning about, in route order. */
export function headsUpHazards(segment: HazardSource): RouteHazard[] {
  const kinds = new Set(HEADS_UP[segment.mode === 'biking' ? 'cycling' : segment.mode ?? ''] ?? [])
  return (segment.hazards ?? []).filter(hazard => kinds.has(hazard.kind) && (hazard.kind !== 'dismount' || pushed(hazard) >= MIN_DISMOUNT_METERS))
}

/** The same, one per kind, most severe first. */
export function legHeadsUp(segment: HazardSource): HeadsUp[] {
  const byKind = new Map<RouteHazardKind, HeadsUp>()
  for (const hazard of headsUpHazards(segment)) {
    const seen = byKind.get(hazard.kind)
    if (seen) {
      seen.count++
      if (SEVERITY[hazard.severity] < SEVERITY[seen.severity]) seen.severity = hazard.severity
    } else {
      byKind.set(hazard.kind, { kind: hazard.kind, at: hazard.startDistance, count: 1, severity: hazard.severity })
    }
  }
  return [...byKind.values()].sort((a, b) => SEVERITY[a.severity] - SEVERITY[b.severity] || a.at - b.at)
}
