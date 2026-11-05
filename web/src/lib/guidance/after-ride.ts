// What a rider does once off a ride: change to another line, walk out to the
// destination, or carry on some other way.

import type { TransitTransfer } from '@server/types/station-guidance.types'
import { transferAt, type GuidedSegment } from '@/lib/transit/station/station-walks'

export interface AfterRideSegment extends GuidedSegment {
  duration?: number
  lineName?: string
  lineColor?: string
  lineTextColor?: string
  headsign?: string
  directionLabel?: string
  arrivalStop?: { name?: string }
  end?: { label?: string }
}

export interface NextLine {
  name: string
  color?: string
  textColor?: string
  toward?: string
}

export type AfterRide =
  | { kind: 'transfer'; line: NextLine; transfer: TransitTransfer | null; walkSec: number | null }
  | { kind: 'walk'; seconds: number; to?: string; exit?: string }
  | { kind: 'travel'; mode: string; seconds: number; to?: string }
  | { kind: 'arrive'; to?: string }

const lineOf = (ride: AfterRideSegment): NextLine => ({
  name: ride.lineName ?? '',
  color: ride.lineColor,
  textColor: ride.lineTextColor,
  toward: ride.directionLabel || ride.headsign || undefined,
})

const exitLabel = (ride: AfterRideSegment) => ride.exit?.cornerLabel || ride.exit?.name || ride.exit?.ref || undefined

/** What follows getting off the ride at `index`. */
export function afterRide(segments: AfterRideSegment[], index: number): AfterRide | null {
  const ride = segments[index]
  if (ride?.mode !== 'transit') return null
  const next = segments[index + 1]
  if (!next) return { kind: 'arrive', to: ride.end?.label ?? ride.arrivalStop?.name }
  if (next.mode === 'transit') return { kind: 'transfer', line: lineOf(next), transfer: transferAt(segments, index + 1), walkSec: null }
  const then = segments[index + 2]
  const seconds = next.duration ?? 0
  if (next.mode === 'walking' && then?.mode === 'transit') {
    const transfer = transferAt(segments, index + 1)
    return { kind: 'transfer', line: lineOf(then), transfer, walkSec: transfer ? null : seconds }
  }
  if (next.mode === 'walking') return { kind: 'walk', seconds, to: next.end?.label, exit: exitLabel(ride) }
  return { kind: 'travel', mode: next.mode, seconds, to: next.end?.label }
}
