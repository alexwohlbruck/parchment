// After a missed boarding: wait for the same line's next run, or ride something else.

import { SAME_RUN_MS } from '@/lib/transit/later-runs'
import { isFollowable, neededGain, type Itinerary, type ItinerarySegment } from './better-itinerary'

interface RecoveryStop {
  id?: string
  name: string
}

export interface RecoverySegment extends ItinerarySegment {
  startTime?: string | Date
  departureStop?: RecoveryStop
  arrivalStop?: RecoveryStop
  routeOptions?: { shortName?: string }[]
}

export interface RecoveryPlan<T> {
  itinerary: T
  /** When its first ride leaves. */
  departureMs: number
  arrivalMs: number
  /** Arrival against the plan that was missed; positive is later. */
  delayMs: number
}

export type Recovery<T> =
  /** Same lines from the same stops, a later run. */
  | { kind: 'retime'; next: RecoveryPlan<T> }
  /** The later run stands, but another plan arrives clearly sooner. */
  | { kind: 'recommend-switch'; next: RecoveryPlan<T>; better: RecoveryPlan<T> }
  /** No sensible later run: the options, soonest arrival first. */
  | { kind: 'choose'; options: RecoveryPlan<T>[] }

export interface MissedRide {
  /** The rest of the plan, from the missed ride on. */
  remaining: RecoverySegment[]
  missedMs: number
  plannedEndMs: number
}

const MUCH_LATER_MS = 15 * 60_000
const MUCH_LATER_SHARE = 1 / 3
const MAX_OPTIONS = 3

const ms = (v?: string | Date) => (v ? new Date(v).getTime() : NaN)
const rides = (segments: RecoverySegment[]) => segments.filter(s => s.mode === 'transit')
const sameStop = (a?: RecoveryStop, b?: RecoveryStop) => !!a && !!b && (a.id && b.id ? a.id === b.id : a.name === b.name)

function sameLine(planned: RecoverySegment, ride: RecoverySegment): boolean {
  if (!ride.lineName) return false
  return ride.lineName === planned.lineName || !!planned.routeOptions?.some(o => o.shortName === ride.lineName)
}

/** Rides the same lines between the same stops as `planned`, whatever the runs. */
export function ridesSameLines(planned: RecoverySegment[], candidate: RecoverySegment[]): boolean {
  const want = rides(planned)
  const got = rides(candidate)
  return (
    want.length > 0 &&
    want.length === got.length &&
    want.every((p, i) => sameLine(p, got[i]) && sameStop(p.departureStop, got[i].departureStop) && sameStop(p.arrivalStop, got[i].arrivalStop))
  )
}

function asPlan<T extends Itinerary<RecoverySegment>>(itinerary: T, plannedEndMs: number): RecoveryPlan<T> {
  const arrivalMs = ms(itinerary.endTime)
  return { itinerary, departureMs: ms(rides(itinerary.segments)[0]?.startTime), arrivalMs, delayMs: arrivalMs - plannedEndMs }
}

/** What to offer a rider who missed `missed`, from plans fresh from where they stand. */
export function classifyRecovery<T extends Itinerary<RecoverySegment>>(missed: MissedRide, candidates: T[], nowMs: number): Recovery<T> | null {
  const plans = candidates
    .filter(c => isFollowable(c.segments))
    .map(c => asPlan(c, missed.plannedEndMs))
    .filter(p => Number.isFinite(p.arrivalMs) && p.departureMs >= nowMs)
    .sort((a, b) => a.arrivalMs - b.arrivalMs)
  const isLaterRun = (p: RecoveryPlan<T>) => ridesSameLines(missed.remaining, p.itinerary.segments)
  const next = plans.find(p => isLaterRun(p) && p.departureMs > missed.missedMs + SAME_RUN_MS)
  const others = plans.filter(p => !isLaterRun(p))
  if (!next) return others.length ? { kind: 'choose', options: others.slice(0, MAX_OPTIONS) } : null

  const better = others[0]
  const gain = better ? next.arrivalMs - better.arrivalMs : 0
  const left = next.arrivalMs - nowMs
  if (better && gain >= Math.max(MUCH_LATER_MS, MUCH_LATER_SHARE * left)) {
    const options = [...others.slice(0, MAX_OPTIONS - 1), next].sort((a, b) => a.arrivalMs - b.arrivalMs)
    return { kind: 'choose', options }
  }
  if (better && gain >= neededGain(next.arrivalMs, nowMs)) return { kind: 'recommend-switch', next, better }
  return { kind: 'retime', next }
}
