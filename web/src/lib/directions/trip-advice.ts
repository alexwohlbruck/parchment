/**
 * When to leave for a transit trip, read off its departure profile: whether to
 * hurry, leave now, or take your time, and what a missed run costs.
 */
import type { DepartureProfile, DepartureRun } from '@/types/multimodal.types'
import { APPROACH_MARGIN_SEC, departureReachability, type DepartureReachability } from '@/lib/transit/transit-reachability'
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
/** Gaps between runs this close together count as a steady frequency. */
const STEADY_HEADWAY_SPREAD_SEC = 90
/** How many gaps after the planned run a frequency is read from. */
const HEADWAY_SAMPLE = 3

export type AdviceState =
  | { kind: 'leave'; nextLaterMin: number; race: Race }
  | { kind: 'hurry'; race: Race; next?: NextRun }
  /** Too late at a walk, but a jog makes it. */
  | { kind: 'run'; race: Race; next?: NextRun }
  /** Time in hand: `future` when the rider planned well ahead. */
  | { kind: 'by'; leaveByMs: number; future?: boolean }
  /** Missing a run costs next to nothing: runs come this often. */
  | { kind: 'frequent'; everyMin: number }
  /** `left`: the planned run has gone; otherwise it is still coming but out of reach. */
  | { kind: 'missed'; departAtMs: number; left: boolean }
  /** No run left in the profile that the rider can reach. */
  | { kind: 'gone' }

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

/**
 * The latest run that arrives with the one departing at `departMs`: the trip
 * should board it, so its times and its advice describe the same train.
 */
export function sameArrivalDepartAt(profile: DepartureProfile | undefined, departMs: number): number | null {
  const runs = profile?.runs ?? []
  const i = runs.findIndex(r => Math.abs(ms(r.departAt) - departMs) <= RUN_MATCH_SEC * 1000)
  return i < 0 ? null : ms(runs[lastSameArrival(runs, i)].departAt)
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

export interface ChangeSegment {
  mode: string
  startTime: Date | string
  endTime: Date | string
  duration: number
  waitSeconds?: number
  departureStop?: { name?: string }
}

/** Changes with little time to make them, keyed by the ride they board: the platform wait left after the walk across. */
export function tightChanges(segments: readonly ChangeSegment[]): Map<number, TightTransfer> {
  const tight = new Map<number, TightTransfer>()
  let from = -1
  segments.forEach((segment, i) => {
    if (segment.mode !== 'transit') return
    const between = segments.slice(from + 1, i)
    if (from >= 0 && between.every(s => s.mode === 'walking')) {
      const movingMs = between.reduce((sum, s) => sum + (s.duration - (s.waitSeconds ?? 0)) * 1000, 0)
      const slackMs = new Date(segment.startTime).getTime() - new Date(segments[from].endTime).getTime() - movingMs
      if (slackMs < TIGHT_TRANSFER_SEC * 1000) {
        tight.set(i, {
          minutes: Math.max(1, Math.round(slackMs / 60_000)),
          ...(segment.departureStop?.name && { stop: segment.departureStop.name }),
        })
      }
    }
    from = i
  })
  return tight
}

function deadlineState(
  runs: DepartureRun[],
  target: number,
  nowMs: number,
  options: AdviceOptions,
): AdviceState | null {
  const run = runs[target]
  const leaveByMs = ms(run.leaveBy)
  if (options.future) return { kind: 'by', leaveByMs, future: true }

  const departAtMs = ms(run.departAt)
  const missCostMin = missCost(runs, target)
  if (missCostMin < QUIET_MISS_COST_MIN) return frequency(runs, target)

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

/** How often runs leave, when they keep a steady gap; irregular service gets no figure. */
function frequency(runs: DepartureRun[], target: number): AdviceState | null {
  const gaps = runs
    .slice(target, target + HEADWAY_SAMPLE + 1)
    .map(r => ms(r.departAt))
    .flatMap((at, i, all) => (i ? [at - all[i - 1]] : []))
  if (gaps.length < 2 || Math.max(...gaps) - Math.min(...gaps) > STEADY_HEADWAY_SPREAD_SEC * 1000) return null
  const everyMin = Math.max(1, Math.round(minutes(gaps.reduce((a, b) => a + b, 0) / gaps.length)))
  return { kind: 'frequent', everyMin }
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

/** The race while walking to the stop under guidance, judged by the same margin as its reach word. */
export function approachRace(departAtMs: number, nowMs: number, toStopSec: number, runFactor: number | null): Race {
  const walkMs = Math.max(0, toStopSec) * 1000
  return { departAtMs, walkMs, spareMs: departAtMs - nowMs - walkMs, bufferMs: APPROACH_MARGIN_SEC * 1000, runFactor }
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

/** The zone the rider reaches the stop in. */
export function arrivalZone(race: Race, nowMs: number): RaceZoneKind {
  const leadMs = Math.max(0, race.departAtMs - nowMs)
  return raceZones(race, leadMs).find(z => race.walkMs <= z.toMs)?.kind ?? 'tooFar'
}

/** The race's zones by spare time at the stop: positive is early, negative is late. */
export function spareZones(race: Race, nowMs: number): RaceZone[] {
  const leadMs = Math.max(0, race.departAtMs - nowMs)
  return raceZones(race, leadMs)
    .map(({ kind, fromMs, toMs }) => ({ kind, fromMs: leadMs - toMs, toMs: leadMs - fromMs }))
    .reverse()
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
  if (current < 0) return { state: { kind: 'gone' }, tight: null, live: runs[planned].live }

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
  iconMode: string
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
        const { key, iconMode } = tripType(alt.segments)
        found = { mode: key, iconMode, atMs }
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

/** The trip page has the walk-vs-train race and the departure board; a result card has neither. */
export type AdviceSurface = 'header' | 'card'

/** One line of advice: a word to act on, if any, then the plain facts behind it. */
export interface AdviceStatus {
  kind: AdviceKind | null
  word: string | null
  tone: string
  details: string[]
}

const spareText = (r: Race, t: TFn, surface: AdviceSurface) => {
  const s = (k: string, named?: Record<string, unknown>) => t(`directions.advice.status.${k}`, named)
  if (r.spareMs < 0) {
    const short = Math.max(1, Math.ceil(minutes(-r.spareMs)))
    return surface === 'header' && r.runFactor ? s('shortWalking', { minutes: short }) : s('short', { minutes: short })
  }
  const spare = Math.floor(minutes(r.spareMs))
  return spare < 1 ? s('spareNone') : s('spare', { minutes: spare })
}

function stateWord(state: AdviceState, nowMs: number, t: TFn): string | null {
  const s = (k: string, named?: Record<string, unknown>) => t(`directions.advice.status.${k}`, named)
  switch (state.kind) {
    case 'by': {
      if (state.future) return s('leaveAt', { time: clock(state.leaveByMs) })
      const inMin = Math.floor(minutes(state.leaveByMs - nowMs))
      return inMin < 1 ? t('directions.advice.short.leave') : s('leaveIn', { minutes: inMin })
    }
    case 'frequent':
      return s('every', { minutes: state.everyMin })
    case 'missed':
      return t(`directions.advice.short.${state.left ? 'missed' : 'tooFar'}`)
    case 'gone':
      return s('gone')
    default:
      return t(`directions.advice.short.${state.kind}`)
  }
}

function stateDetails(state: AdviceState, t: TFn, surface: AdviceSurface): string[] {
  const s = (k: string, named?: Record<string, unknown>) => t(`directions.advice.status.${k}`, named)
  const next = (laterMin?: number) => (laterMin ? [s('next', { minutes: laterMin })] : [])
  const header = surface === 'header'
  switch (state.kind) {
    case 'leave':
      return [...(header ? [spareText(state.race, t, surface)] : []), ...next(state.nextLaterMin)]
    case 'hurry':
    case 'run':
      return [header ? spareText(state.race, t, surface) : clock(state.race.departAtMs), ...next(state.next?.laterMin)]
    case 'missed':
      return header ? [s('nextAt', { time: clock(state.departAtMs) })] : [s('finding')]
    case 'gone':
      return [s('finding')]
    default:
      return []
  }
}

/**
 * What to do, as one line. Calm states read as a plain countdown; only the
 * states that ask the rider to act take a colour. A result card also carries
 * a tight change, which the trip page shows on the change itself.
 */
export function adviceStatus(advice: TripAdvice, nowMs: number, t: TFn, surface: AdviceSurface): AdviceStatus | null {
  const { state, tight } = advice
  const details = state ? stateDetails(state, t, surface) : []
  const word = state && stateWord(state, nowMs, t)
  if (surface === 'card' && tight && state?.kind !== 'missed' && state?.kind !== 'gone') {
    details.push(t('directions.advice.status.change', { minutes: tight.minutes }))
  }
  if (!word && !details.length) return null
  return { kind: state?.kind ?? null, word, tone: state ? adviceTone(state.kind) : '', details }
}

const ADVICE_TONES: Partial<Record<AdviceKind, string>> = {
  hurry: 'text-amber-600 dark:text-amber-400',
  run: 'text-orange-600 dark:text-orange-400',
  missed: 'text-muted-foreground',
  gone: 'text-muted-foreground',
}

/** The board's word for the planned run, matching the advice. */
export function adviceReach(state: AdviceState | null): DepartureReachability {
  if (state?.kind === 'hurry' || state?.kind === 'run') return state.kind
  if (state?.kind === 'missed') return state.left ? 'departed' : 'unreachable'
  if (state?.kind === 'gone') return 'unreachable'
  return 'ok'
}

/** Accent for states that ask the rider to act; calm states and "leave now" read in plain ink. */
export function adviceTone(kind: AdviceKind): string {
  return ADVICE_TONES[kind] ?? ''
}

/** The board never mutes a run we only estimate you'll miss: the rider is often closer than we think. */
const MISS_TONE = 'text-orange-600 dark:text-orange-400'

const REACH_WORDS: Partial<Record<DepartureReachability, { key: string; tone: string }>> = {
  departed: { key: 'missed', tone: MISS_TONE },
  unreachable: { key: 'tooFar', tone: MISS_TONE },
  run: { key: 'run', tone: adviceTone('run') },
  hurry: { key: 'hurry', tone: adviceTone('hurry') },
}

/** The short word every surface uses for how reachable a run is; none when it's comfortable. */
export function reachWord(state: DepartureReachability, t: TFn): HintWord | null {
  const entry = REACH_WORDS[state]
  return entry ? { word: t(`directions.advice.short.${entry.key}`), tone: entry.tone } : null
}
