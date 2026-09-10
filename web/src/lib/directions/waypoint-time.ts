import dayjs, { type Dayjs } from 'dayjs'
import type { WaypointTimeConstraint } from '@/types/map.types'

/** Where a stop sits in the trip, which decides what can be asked of it. */
export type WaypointRole = 'origin' | 'stop' | 'destination'

export function waypointRole(index: number, count: number): WaypointRole {
  if (index === 0) return 'origin'
  if (index === count - 1) return 'destination'
  return 'stop'
}

/** Minutes offered as one tap, for both "leave later" and "stay a while". */
export const QUICK_OFFSETS = [15, 30, 60] as const
export const DWELL_OPTIONS = [15, 30, 60] as const

/**
 * Round up to the next five minutes.
 *
 * Times reached by arithmetic land on things like 1:37; nobody plans to leave
 * at 1:37, and an odd number in the field reads like a bug rather than a
 * suggestion.
 */
export function roundUpToFive(time: Dayjs): Dayjs {
  const remainder = time.minute() % 5
  return (remainder ? time.add(5 - remainder, 'minute') : time)
    .second(0)
    .millisecond(0)
}

/**
 * What the trigger says, and how loudly.
 *
 * `set` is the rider's own instruction and reads as one. `derived` is what
 * the trip already implies for this stop — worth showing, but not worth
 * dressing up as a decision they made.
 */
export function constraintSummary(
  constraint: WaypointTimeConstraint | null | undefined,
  arrivesAt: Date | null | undefined,
): { text: string; tone: 'set' | 'derived' } | null {
  if (constraint?.time) {
    const at = dayjs(constraint.time).format('h:mm A')
    const verb = constraint.mode === 'arriveBy' ? 'By' : 'From'
    return { text: `${verb} ${at}`, tone: 'set' }
  }
  if (constraint?.dwellTime) {
    return { text: formatDwell(constraint.dwellTime), tone: 'set' }
  }
  if (arrivesAt) {
    return { text: dayjs(arrivesAt).format('h:mm A'), tone: 'derived' }
  }
  return null
}

/** "45 min" / "1 hr" / "1 hr 30 min" — a duration a person would say. */
export function formatDwell(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`
}

export interface ConstraintCheck {
  /** The composed instant, or null when only a dwell is being set. */
  time: Dayjs | null
  dwellMinutes: number | null
  previous?: WaypointTimeConstraint | null
  next?: WaypointTimeConstraint | null
  now?: Dayjs
}

/**
 * Why this constraint can't hold, in one sentence, or null if it can.
 *
 * Only one problem is reported: a stop with three impossible things about it
 * is still fixed one change at a time, and a stack of warnings in a popover
 * the size of a phone reads as failure rather than guidance.
 */
export function constraintWarning({
  time,
  dwellMinutes,
  previous,
  next,
  now = dayjs(),
}: ConstraintCheck): string | null {
  if (!time?.isValid()) return null

  if (time.isBefore(now)) return 'That time has passed.'

  if (previous?.time) {
    const earliest = dayjs(previous.time).add(previous.dwellTime ?? 0, 'minute')
    if (time.isBefore(earliest)) {
      return `The stop before this one isn't free until ${earliest.format('h:mm A')}.`
    }
  }

  if (next?.time) {
    const leaving = time.add(Math.max(0, dwellMinutes ?? 0), 'minute')
    if (leaving.isAfter(dayjs(next.time))) {
      return `Leaving at ${leaving.format('h:mm A')} misses the next stop.`
    }
  }

  return null
}

/** The constraint a draft describes, or null when it asks for nothing. */
export function buildConstraint(draft: {
  mode: WaypointTimeConstraint['mode']
  time: Dayjs | null
  dwellMinutes: number | null
}): WaypointTimeConstraint | null {
  const dwell = draft.dwellMinutes && draft.dwellMinutes > 0 ? draft.dwellMinutes : null
  if (!draft.time?.isValid() && !dwell) return null

  return {
    mode: draft.mode,
    ...(draft.time?.isValid() && { time: draft.time.toISOString() }),
    ...(dwell && { dwellTime: dwell }),
  }
}

/**
 * The trip-request fields one waypoint's constraint contributes.
 *
 * A stay with no clock time is a real instruction — "give me half an hour
 * here" — so it travels on its own, without inventing a time to hang it on.
 */
export function constraintRequestFields(
  constraint: WaypointTimeConstraint | null | undefined,
): { departAfter?: string; arriveBy?: string; dwellTime?: number } {
  if (!constraint) return {}
  return {
    ...(constraint.time && constraint.mode === 'departAfter'
      && { departAfter: constraint.time }),
    ...(constraint.time && constraint.mode === 'arriveBy'
      && { arriveBy: constraint.time }),
    ...(constraint.dwellTime && { dwellTime: constraint.dwellTime }),
  }
}
