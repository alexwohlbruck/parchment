// Step-by-step guidance through a station, where GPS can't follow: the
// walk from the entrance down to the platform, between two rides, and from
// the platform up to the street.

import type { GuidanceStep, StationWalk } from '@server/types/station-guidance.types'
import { isWalked, platformSpot, type GuidedSegment, type PlatformSpot, type StationWalkKind } from '@/lib/transit/station/station-walks'
import type { TransitStage } from './transit-progress'

export interface StationGuideTarget {
  key: string
  kind: StationWalkKind
  ride: number
  walk: StationWalk & { steps: GuidanceStep[] }
  /** When the ride walked to leaves; null leaving the station. */
  departureMs: number | null
  spot: PlatformSpot | null
}

/** On the street walk away from a station by this much, GPS has the rider again. */
export const STREET_RESUME_METERS = 30

const guidable = (walk: StationWalk | null | undefined): walk is StationGuideTarget['walk'] =>
  isWalked(walk) && !!walk.steps?.length

function target(
  segments: GuidedSegment[],
  kind: StationWalkKind,
  ride: number,
  walk: StationWalk | null | undefined,
  departureMs: number | null = null,
): StationGuideTarget | null {
  if (!guidable(walk)) return null
  return { key: `${kind}:${ride}`, kind, ride, walk, departureMs, spot: platformSpot(segments, kind, ride) }
}

/** The ride before `index`, when nothing but a walk inside the station lies between. */
function changesFrom(segments: GuidedSegment[], index: number): boolean {
  const previous = segments[index - 1]
  return previous?.mode === 'transit' || (previous?.mode === 'walking' && segments[index - 2]?.mode === 'transit')
}

/**
 * The station walk the rider is on: heading for a ride's platform from
 * another ride or from the entrance, or leaving the last ride for the street
 * until GPS shows them walking away. `into` is how far into the current
 * segment the rider is.
 */
export function stationGuideTarget(
  segments: GuidedSegment[],
  stage: TransitStage | null,
  current: { index: number; into: number } | null,
): StationGuideTarget | null {
  if (stage?.kind === 'to-stop' || stage?.kind === 'wait') {
    const ride = segments[stage.segmentIndex]
    if (changesFrom(segments, stage.segmentIndex)) return target(segments, 'transfer', stage.segmentIndex, ride?.transfer?.walk, stage.departureMs)
    return stage.kind === 'wait' ? target(segments, 'access', stage.segmentIndex, ride?.entrance?.walk, stage.departureMs) : null
  }
  if (stage || !current || segments[current.index]?.mode !== 'walking' || current.into >= STREET_RESUME_METERS) return null
  const ride = current.index - 1
  return segments[ride]?.mode === 'transit' ? target(segments, 'egress', ride, segments[ride].exit?.walk) : null
}
