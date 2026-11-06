import type { GuidedSegment, PlacedWalk } from './station-walks'

export interface SignedSegment extends GuidedSegment {
  lineName?: string
  headsign?: string
  directionLabel?: string
}

/** What the station's own signs point to, for a walk we can't route step by step. */
export type StationSign =
  | { kind: 'platform'; line: string; toward?: string }
  /** The exit itself is already named on the walk's row. */
  | { kind: 'exit' }

export function stationSign(segments: SignedSegment[], placed: PlacedWalk): StationSign | null {
  const ride = segments[placed.ride]
  if (!ride) return null
  if (placed.kind === 'egress') return { kind: 'exit' }
  if (placed.kind === 'transfer' && ride.transfer?.class === 'same_platform') return null
  if (!ride.lineName) return null
  return { kind: 'platform', line: ride.lineName, toward: ride.directionLabel || ride.headsign || undefined }
}
