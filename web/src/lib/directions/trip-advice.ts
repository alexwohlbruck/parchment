/**
 * When to leave for a transit trip, read off its departure profile: whether to
 * hurry, leave now, or take your time, and what a missed run costs.
 */
import type { DepartureProfile, DepartureRun } from '@/types/multimodal.types'
import { departureReachability, type DepartureReachability } from '@/lib/transit/transit-reachability'
import { formatClockCompact } from './trip-display'
import { tripType, type TripTypeSegment } from './trip-type'
import { DEFAULT_TRANSIT_BUFFER_MINUTES } from '@/lib/preferences/navigation-preferences'

/** Under this much time to leave, a costly miss is worth a nudge. */
const LEAVE_LEAD_MIN = 5
/** Missing a run costs at least this much: worth leaving now, or running for. */
const COSTLY_MISS_COST_MIN = 8
/** Missing a run costs less than this on frequent service: no rushing, no deadline. */
const QUIET_MISS_COST_MIN = 4
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
  | { kind: 'leave'; nextLaterMin: number; race: Race }
  | { kind: 'hurry'; race: Race; next?: NextRun }
  /** Too late at a walk, but a jog makes it. */
  | { kind: 'run'; race: Race; next?: NextRun }
  | { kind: 'by'; leaveByMs: number }
  /** `left`: the planned run has gone; otherwise it is still coming but out of reach. */
  | { kind: 'missed'; departAtMs: number; left: boolean }

export type AdviceKind = AdviceState['kind']

/** The walk to the first stop against the run it has to meet; `spareMs` goes negative when the walk is too long. */
export interface Race {
  departAtMs: number
  walkMs: number
  spareMs: number
  /** The rider's arrive-early margin. */
  bufferMs: number
  runFactor: number | null
}

/** The run after a rushed one, so the rider can weigh just waiting for it. */
export interface NextRun {
  departAtMs: number
  laterMin: number
}

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
  /** How much faster than walking the rider can run to the first stop; omit when they can't. */
  runFactor?: number | null
  /** The planned run as the rider sees it now: its live departure and the walk still ahead. */
  boarding?: Boarding
}

export interface Boarding {
  departAtMs: number
  walkSec: number
}

const iso = (msValue: number) => new Date(msValue).toISOString()

function withBoarding(runs: DepartureRun[], planned: number, boarding?: Boarding): DepartureRun[] {
  if (!boarding) return runs
  const run = { ...runs[planned], departAt: iso(boarding.departAtMs), leaveBy: iso(boarding.departAtMs - boarding.walkSec * 1000) }
  return runs.map((r, i) => (i === planned ? run : r))
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
  const missCostMin = missCost(runs, target)
  if (missCostMin < QUIET_MISS_COST_MIN) return null

  const bufferMin = options.transitBufferMinutes ?? DEFAULT_TRANSIT_BUFFER_MINUTES
  const reach = departureReachability(departAtMs, nowMs, (departAtMs - leaveByMs) / 1000, bufferMin * 60)
  if (reach === 'hurry') return { kind: 'hurry', race: race(run, nowMs, options), ...nextRun(runs, target) }

  if (!Number.isFinite(missCostMin)) return null
  if (minutes(leaveByMs - nowMs) < LEAVE_LEAD_MIN && missCostMin >= COSTLY_MISS_COST_MIN) {
    return { kind: 'leave', nextLaterMin: Math.round(missCostMin), race: race(run, nowMs, options) }
  }
  return { kind: 'by', leaveByMs }
}

/** How much later the rider arrives on the next run; unknown past the profile's last run. */
function missCost(runs: DepartureRun[], target: number): number {
  const next = runs[target + 1]
  return next ? minutes(ms(next.arriveAt) - ms(runs[target].arriveAt)) : Infinity
}

function race(run: DepartureRun, nowMs: number, options: AdviceOptions): Race {
  const departAtMs = ms(run.departAt)
  return {
    departAtMs,
    walkMs: departAtMs - ms(run.leaveBy),
    spareMs: ms(run.leaveBy) - nowMs,
    bufferMs: (options.transitBufferMinutes ?? DEFAULT_TRANSIT_BUFFER_MINUTES) * 60_000,
    runFactor: options.runFactor ?? null,
  }
}

export type RaceZoneKind = 'calm' | 'leave' | 'hurry' | 'run' | 'tooFar'

export interface RaceZone {
  kind: RaceZoneKind
  fromMs: number
  toMs: number
}

/** What arriving at each point along the walk would mean, given `leadMs` until the train leaves. */
export function raceZones(race: Race, leadMs: number): RaceZone[] {
  const leaveFrom = Math.max(0, leadMs - LEAVE_LEAD_MIN * 60_000)
  const hurryFrom = Math.max(leaveFrom, leadMs - race.bufferMs)
  const runTo = race.runFactor ? leadMs * race.runFactor : leadMs
  const edges: [RaceZoneKind, number, number][] = [
    ['calm', 0, leaveFrom],
    ['leave', leaveFrom, hurryFrom],
    ['hurry', hurryFrom, leadMs],
    ['run', leadMs, runTo],
    ['tooFar', runTo, Infinity],
  ]
  return edges.filter(([, from, to]) => to > from).map(([kind, fromMs, toMs]) => ({ kind, fromMs, toMs }))
}

function nextRun(runs: DepartureRun[], target: number): { next?: NextRun } {
  const next = runs[target + 1]
  if (!next) return {}
  return { next: { departAtMs: ms(next.departAt), laterMin: Math.max(1, Math.round(missCost(runs, target))) } }
}

/** Walking is too slow for the run, but a jog is not. */
function jogOnly(run: DepartureRun, nowMs: number, runFactor: number): boolean {
  const departAtMs = ms(run.departAt)
  const leadMs = departAtMs - nowMs
  if (ms(run.leaveBy) >= nowMs || leadMs <= 0) return false
  return leadMs * runFactor >= departAtMs - ms(run.leaveBy)
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
  if (!profile?.runs.length) return null

  const planned = plannedIndex(profile, options.boardsAtMs)
  const runs = withBoarding(profile.runs, planned, options.boarding)
  const target = lastSameArrival(runs, planned)
  const jog = !!options.runFactor && !options.future && jogOnly(runs[target], nowMs, options.runFactor)
  if (jog && missCost(runs, target) >= COSTLY_MISS_COST_MIN) {
    const state: AdviceState = { kind: 'run', race: race(runs[target], nowMs, options), ...nextRun(runs, target) }
    return { state, tight: tightTransfer(runs[target]), live: runs[target].live }
  }

  const current = runs.findIndex((r, i) => i >= planned && ms(r.leaveBy) >= nowMs)
  if (current < 0) return null

  const run = runs[current]
  // Not worth running for when the next one is close behind: plan around it without calling a miss.
  const state: AdviceState | null =
    current <= target
      ? deadlineState(runs, target, nowMs, options)
      : jog
        ? deadlineState(runs, lastSameArrival(runs, current), nowMs, options)
        : { kind: 'missed', departAtMs: ms(run.departAt), left: ms(runs[target].departAt) <= nowMs }

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

/** The trip reaches its first stop on foot, so running would actually get there sooner. */
export function walksToFirstStop(segments: readonly { mode: string }[]): boolean {
  const first = segments.findIndex(s => s.mode === 'transit')
  return first > 0 && segments.slice(0, first).every(s => s.mode === 'walking')
}

/** When the trip boards its first ride. */
export function boardsAtMs(segments: readonly { mode: string; startTime: Date | string }[]): number | undefined {
  const seg = segments.find(s => s.mode === 'transit')
  return seg && new Date(seg.startTime).getTime()
}

type TFn = (key: string, named?: Record<string, unknown>) => string

const clock = (msValue: number) => formatClockCompact(new Date(msValue))

export function crossoverText(c: Crossover, t: TFn): string {
  return t('directions.advice.crossover', {
    mode: t(`directions.advice.modes.${c.mode}`),
    time: clock(c.atMs),
  })
}

export interface HintWord {
  word: string
  tone: string
}

/** A short label: toned ones ask the rider to act, plain ones carry a fact. */
export interface Badge {
  text: string
  tone: string
}

/** The trip page has the walk-vs-train race and the departure board; a result card has neither. */
export type AdviceSurface = 'header' | 'card'

const BADGE_TONES = {
  urgent: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  missed: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
  fact: 'bg-muted text-muted-foreground',
}

function stateWord(state: AdviceState, t: TFn): Badge | null {
  if (state.kind === 'by') return null
  return {
    text: t(`directions.advice.short.${state.kind === 'missed' && !state.left ? 'tooFar' : state.kind}`),
    tone: state.kind === 'missed' || state.kind === 'run' ? BADGE_TONES.missed : BADGE_TONES.urgent,
  }
}

function stateFacts(state: AdviceState, t: TFn, surface: AdviceSurface): string[] {
  const badge = (k: string, named?: Record<string, unknown>) => t(`directions.advice.badge.${k}`, named)
  const next = (minutes?: number) => (minutes ? [badge('next', { minutes })] : [])
  const race = (r: Race) => {
    if (r.spareMs < 0) return badge('short', { minutes: Math.max(1, Math.ceil(minutes(-r.spareMs))) })
    const spare = Math.floor(minutes(r.spareMs))
    return spare < 1 ? badge('spareNone') : badge('spare', { minutes: spare })
  }
  const header = surface === 'header'
  switch (state.kind) {
    case 'by':
      return [badge('by', { time: clock(state.leaveByMs) })]
    case 'leave':
      return header ? [race(state.race)] : next(state.nextLaterMin)
    case 'hurry':
    case 'run':
      return header ? [race(state.race)] : [badge('departs', { time: clock(state.race.departAtMs) }), ...next(state.next?.laterMin)]
    case 'missed':
      return header ? [badge('nextAt', { time: clock(state.departAtMs) })] : [badge('finding')]
  }
}

function tightFact(tight: TightTransfer, t: TFn): string {
  return tight.stop
    ? t('directions.advice.badge.tight', { minutes: tight.minutes, stop: tight.stop })
    : t('directions.advice.badge.tightAnywhere', { minutes: tight.minutes })
}

/** What to do, then the few facts behind it, as short badges. */
export function adviceBadges(advice: TripAdvice, t: TFn, surface: AdviceSurface): Badge[] {
  const { state, tight } = advice
  const badges: Badge[] = []
  const word = state && stateWord(state, t)
  if (word) badges.push(word)
  const showTight = tight && state?.kind !== 'missed'
  if (showTight) badges.push({ text: t('directions.advice.short.tight'), tone: BADGE_TONES.urgent })
  const facts = state ? stateFacts(state, t, surface) : []
  if (showTight && (surface === 'header' || !state)) facts.push(tightFact(tight, t))
  if (surface === 'header' && !advice.live) facts.push(t('directions.advice.badge.sched'))
  return [...badges, ...facts.map(text => ({ text, tone: BADGE_TONES.fact }))]
}

const ADVICE_TONES: Partial<Record<AdviceKind, string>> = {
  hurry: 'text-amber-600 dark:text-amber-400',
  leave: 'text-amber-600 dark:text-amber-400',
  run: 'text-orange-600 dark:text-orange-400',
  missed: 'text-orange-600 dark:text-orange-400',
}

/** The board's word for the planned run, matching the advice. */
export function adviceReach(state: AdviceState | null): DepartureReachability {
  if (state?.kind === 'hurry' || state?.kind === 'run') return state.kind
  if (state?.kind === 'missed') return state.left ? 'departed' : 'unreachable'
  return 'ok'
}

/** Accent for states that ask the rider to act; calm states take none. */
export function adviceTone(kind: AdviceKind): string {
  return ADVICE_TONES[kind] ?? ''
}

const REACH_WORDS: Partial<Record<DepartureReachability, { key: string; tone: AdviceKind }>> = {
  departed: { key: 'missed', tone: 'missed' },
  unreachable: { key: 'tooFar', tone: 'missed' },
  run: { key: 'run', tone: 'run' },
  hurry: { key: 'hurry', tone: 'hurry' },
}

/** The short word every surface uses for how reachable a run is; none when it's comfortable. */
export function reachWord(state: DepartureReachability, t: TFn): HintWord | null {
  const entry = REACH_WORDS[state]
  return entry ? { word: t(`directions.advice.short.${entry.key}`), tone: adviceTone(entry.tone) } : null
}
