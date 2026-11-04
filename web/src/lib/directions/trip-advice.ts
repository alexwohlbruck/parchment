/**
 * When to leave for a transit trip, read off its departure profile: whether to
 * hurry, leave now, or take your time, and what a missed run costs.
 */
import type { DepartureProfile, DepartureRun } from '@/types/multimodal.types'
import { departureReachability } from '@/lib/transit/transit-reachability'
import { formatClockCompact } from './trip-display'
import { tripType, type TripTypeSegment } from './trip-type'

export const DEFAULT_TRANSIT_BUFFER_MIN = 2
/** Under this much time to leave, an expensive miss is worth a nudge. */
const LEAVE_LEAD_MIN = 5
const LEAVE_MISS_COST_MIN = 8
/** Missing a run costs less than this on frequent service: say nothing. */
const RELAX_MISS_COST_MIN = 4
const TIGHT_TRANSFER_SEC = 120
/** Runs arriving this close together count as the same arrival. */
const SAME_ARRIVAL_SEC = 60
/** A depart-at time this far ahead is a plan, not a trip starting now. */
const FUTURE_PLAN_MIN = 20
/** How much sooner another mode must arrive to be called faster. */
const CROSSOVER_MARGIN_SEC = 60
/** A run departing this close to the trip's boarding time is that run. */
const RUN_MATCH_SEC = 60

export type AdviceState =
  | { kind: 'leave'; nextLaterMin: number }
  | { kind: 'hurry'; leadMin: number; departAtMs: number }
  | { kind: 'relax'; leaveByMs: number }
  | { kind: 'by'; leaveByMs: number }
  | { kind: 'missed'; departAtMs: number }

export type AdviceKind = AdviceState['kind']

export interface TightTransfer {
  minutes: number
  stop?: string
}

export interface TripAdvice {
  state: AdviceState | null
  tight: TightTransfer | null
  live: boolean
}

export interface AdviceOptions {
  transitBufferMinutes?: number
  /** The rider set a depart-at time well ahead. */
  future?: boolean
  /** When the trip boards its first transit leg; re-finds the planned run after a rebooking. */
  boardsAtMs?: number
}

const ms = (iso: string) => Date.parse(iso)
const minutes = (msValue: number) => msValue / 60_000

function plannedIndex(profile: DepartureProfile, boardsAtMs?: number): number {
  if (boardsAtMs != null) {
    const match = profile.runs.findIndex(
      r => Math.abs(ms(r.departAt) - boardsAtMs) <= RUN_MATCH_SEC * 1000,
    )
    if (match >= 0) return match
  }
  return Math.min(Math.max(0, profile.plannedRunIndex), profile.runs.length - 1)
}

/** Index of the last run from `i` on that still arrives with run `i`. */
function lastSameArrival(runs: DepartureRun[], i: number): number {
  const arrive = ms(runs[i].arriveAt)
  let j = i
  while (j + 1 < runs.length && ms(runs[j + 1].arriveAt) - arrive <= SAME_ARRIVAL_SEC * 1000) j++
  return j
}

function tightTransfer(run: DepartureRun): TightTransfer | null {
  const slack = run.minTransferSlackSec
  if (slack == null || slack >= TIGHT_TRANSFER_SEC) return null
  return {
    minutes: Math.max(1, Math.round(slack / 60)),
    ...(run.tightestTransferAt && { stop: run.tightestTransferAt }),
  }
}

function deadlineState(
  runs: DepartureRun[],
  target: number,
  nowMs: number,
  options: AdviceOptions,
): AdviceState | null {
  const run = runs[target]
  const leaveByMs = ms(run.leaveBy)
  if (options.future) return { kind: 'by', leaveByMs }

  const departAtMs = ms(run.departAt)
  const bufferMin = options.transitBufferMinutes ?? DEFAULT_TRANSIT_BUFFER_MIN
  const reach = departureReachability(departAtMs, nowMs, (departAtMs - leaveByMs) / 1000, bufferMin * 60)
  const leadMin = minutes(leaveByMs - nowMs)
  if (reach === 'hurry') return { kind: 'hurry', leadMin: Math.max(1, Math.floor(leadMin)), departAtMs }

  const next = runs[target + 1]
  if (!next) return null
  const missCostMin = minutes(ms(next.arriveAt) - ms(run.arriveAt))
  if (leadMin < LEAVE_LEAD_MIN) {
    return missCostMin >= LEAVE_MISS_COST_MIN
      ? { kind: 'leave', nextLaterMin: Math.round(missCostMin) }
      : null
  }
  return missCostMin >= RELAX_MISS_COST_MIN ? { kind: 'relax', leaveByMs } : null
}

/**
 * The current run is the planned one, or the next still catchable. The headline
 * reads against the latest run with the planned arrival, so a later train that
 * makes the same connection is not a miss.
 */
export function tripAdvice(
  profile: DepartureProfile | undefined,
  nowMs: number,
  options: AdviceOptions = {},
): TripAdvice | null {
  const runs = profile?.runs ?? []
  if (!profile || !runs.length) return null

  const planned = plannedIndex(profile, options.boardsAtMs)
  const current = runs.findIndex((r, i) => i >= planned && ms(r.leaveBy) >= nowMs)
  if (current < 0) return null

  const run = runs[current]
  const target = lastSameArrival(runs, planned)
  const state: AdviceState | null =
    current > target
      ? { kind: 'missed', departAtMs: ms(run.departAt) }
      : deadlineState(runs, target, nowMs, options)

  return { state, tight: tightTransfer(run), live: run.live }
}

export function isFuturePlan(departureTime: string | null | undefined, nowMs: number): boolean {
  return departureTime != null && minutes(ms(departureTime) - nowMs) > FUTURE_PLAN_MIN
}

export interface AdviceTrip {
  rank: number
  segments: TripTypeSegment[]
  summary: { totalDuration: number }
  departureProfile?: DepartureProfile
}

export interface Crossover {
  /** `tripType` key of the faster trip. */
  mode: string
  atMs: number
}

/**
 * When a constant-duration trip (bike, walk…) overtakes the rank-1 transit trip:
 * the first leave time inside the profile after which it arrives sooner.
 */
export function crossover(trips: readonly AdviceTrip[], nowMs: number): Crossover | null {
  const best = trips.reduce<AdviceTrip | null>((a, b) => (!a || b.rank < a.rank ? b : a), null)
  const profile = best?.departureProfile
  if (!profile || !best.segments.some(s => s.mode === 'transit')) return null

  const runs = profile.runs
  const validUntilMs = ms(profile.validUntil)
  const first = runs.findIndex(r => ms(r.leaveBy) >= nowMs)
  if (first < 0) return null

  const marginMs = CROSSOVER_MARGIN_SEC * 1000
  let found: Crossover | null = null
  for (const alt of trips) {
    if (alt.segments.some(s => s.mode === 'transit')) continue
    const durMs = alt.summary.totalDuration * 1000
    if (nowMs + durMs + marginMs <= ms(runs[first].arriveAt)) continue

    for (let i = first + 1; i < runs.length; i++) {
      const atMs = ms(runs[i - 1].leaveBy)
      if (atMs > validUntilMs || (found && atMs >= found.atMs)) break
      if (atMs + durMs + marginMs <= ms(runs[i].arriveAt)) {
        found = { mode: tripType(alt.segments).key, atMs }
        break
      }
    }
  }
  return found
}

/** When the first of these trips' profiles runs out; past it, re-plan. */
export function adviceValidUntil(trips: readonly { departureProfile?: DepartureProfile }[]): number | null {
  const times = trips.flatMap(t => (t.departureProfile ? [ms(t.departureProfile.validUntil)] : []))
  return times.length ? Math.min(...times) : null
}

export interface BoardingLeg {
  departMs: number
  /** Short name, absent when the leg merges interchangeable lines. */
  line?: string
}

export function boardingLeg(
  segments: readonly { mode: string; startTime: Date | string; lineName?: string; routeOptions?: unknown[] }[],
): BoardingLeg | null {
  const seg = segments.find(s => s.mode === 'transit')
  if (!seg) return null
  const merged = (seg.routeOptions?.length ?? 0) > 1
  return {
    departMs: new Date(seg.startTime).getTime(),
    ...(!merged && seg.lineName && { line: seg.lineName }),
  }
}

type TFn = (key: string, named?: Record<string, unknown>) => string

const clock = (msValue: number) => formatClockCompact(new Date(msValue))

export function adviceText(state: AdviceState, t: TFn, line?: string): string {
  const key = (k: string) => `directions.advice.long.${k}`
  switch (state.kind) {
    case 'leave':
      return t(key('leave'), { minutes: state.nextLaterMin })
    case 'hurry':
      return t(key(line ? 'hurryLine' : 'hurry'), { minutes: state.leadMin, time: clock(state.departAtMs), line })
    case 'relax':
    case 'by':
      return t(key(state.kind), { time: clock(state.leaveByMs) })
    case 'missed':
      return t(key(line ? 'missedLine' : 'missed'), { time: clock(state.departAtMs), line })
  }
}

export function tightText(tight: TightTransfer, t: TFn): string {
  return tight.stop
    ? t('directions.advice.long.tight', { minutes: tight.minutes, stop: tight.stop })
    : t('directions.advice.long.tightAnywhere', { minutes: tight.minutes })
}

export function crossoverText(c: Crossover, t: TFn): string {
  return t('directions.advice.long.crossover', {
    mode: t(`directions.advice.modes.${c.mode}`),
    time: clock(c.atMs),
  })
}

const ADVICE_TONES: Partial<Record<AdviceKind, string>> = {
  hurry: 'text-amber-600 dark:text-amber-400',
  leave: 'text-amber-600 dark:text-amber-400',
  missed: 'text-orange-600 dark:text-orange-400',
}

/** Accent for states that ask the rider to act; calm states take none. */
export function adviceTone(kind: AdviceKind): string {
  return ADVICE_TONES[kind] ?? ''
}
