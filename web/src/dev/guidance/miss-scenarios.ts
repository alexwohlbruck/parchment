// Stand-in fresh plans that force each kind of missed-boarding recovery.

import { shiftSegmentTimes, type RebookableSegment } from '@/lib/directions/trip-rebooking'
import type { TripOption } from '@/types/directions.types'
import { OTHER_LINE_COLORS, otherLineName } from './vehicle-scenarios'

export type MissScenario = 'next-run' | 'better-line' | 'no-next-run'

type Segment = TripOption['segments'][number]

const MIN = 60_000
const toMs = (v: string | Date) => new Date(v).getTime()

/** The rest of the plan from the missed ride on, its first ride leaving at `departureMs`, optionally on another line. */
function runAt(remaining: Segment[], departureMs: number, otherLine: boolean, id: string): TripOption {
  const segments = remaining.map(s => JSON.parse(JSON.stringify(s)) as Segment)
  const delta = departureMs - toMs(segments[0].startTime)
  segments.forEach(s => shiftSegmentTimes(s as unknown as RebookableSegment, delta))
  const first = segments[0]
  if (otherLine) Object.assign(first, { lineName: otherLineName(first), lineColor: OTHER_LINE_COLORS.color, lineTextColor: OTHER_LINE_COLORS.textColor })
  first.tripId = id
  const end = segments.at(-1)!.endTime
  return { id, mode: 'transit', segments, startTime: first.startTime, endTime: end, rank: 1, provider: 'dev' } as unknown as TripOption
}

/** The plans `scenario` stands for, with `remaining` starting at the missed ride. */
export function missCandidates(scenario: MissScenario, remaining: Segment[], nowMs: number): TripOption[] {
  const at = (min: number) => nowMs + min * MIN
  return {
    'next-run': [runAt(remaining, at(6), false, 'dev-next'), runAt(remaining, at(5), true, 'dev-other')],
    'better-line': [runAt(remaining, at(8), false, 'dev-next'), runAt(remaining, at(1), true, 'dev-other')],
    'no-next-run': [runAt(remaining, at(3), true, 'dev-other'), runAt(remaining, at(9), true, 'dev-other-later')],
  }[scenario]
}
