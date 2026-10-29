// Which vehicle a rider actually boarded: an earlier or later run than
// planned, or an interchangeable line serving the same stops.

import { distanceMeters } from '@/lib/map/movement-interpolation'
import type { LngLat } from '@/types/map.types'
import { stopKey, type RideStop, type TransitStopInput } from './transit-progress'

export interface VehicleCandidate {
  tripId: string
  line: string
  color?: string
  textColor?: string
  routeType?: number
  headsign?: string
  departureMs: number
  /** The leg's later stops this run calls at, by stop key. */
  calls: { stop: string; timeMs: number }[]
  position?: LngLat & { atMs: number }
}

export interface CandidateSet {
  candidates: VehicleCandidate[]
  /** Stops whose calls are known: a run missing a call at one of them passes it by. */
  known: string[]
}

export interface StopObservation {
  stop: string
  atMs: number
  dwelled: boolean
}

export interface RideEvidence {
  /** When the rider left the boarding stop at vehicle speed. */
  boardedAtMs: number | null
  stops: StopObservation[]
  /** The next planned stop when the rider left the planned path for good. */
  divergedBefore: string | null
  position: LngLat | null
  positionMs: number | null
}

export interface RideSample {
  s: number
  speed: number
  snapped: boolean
  position: LngLat
  nowMs: number
}

const AT_STOP_METERS = 30
const BOARDED_METERS = 60
const VEHICLE_SPEED = 4
const NEAR_STOP_METERS = 60
const DWELL_SPEED = 1
const DWELL_MS = 8000
const DIVERGED_MS = 30_000

/** Collects what the ride itself says about the vehicle: when it left, where it stopped, where it went. */
export class RideObserver {
  boardedAtMs: number | null = null
  private lastAtBoardMs: number | null = null
  private lastMs: number | null = null
  private next = 1
  private dwellMs = 0
  private closest: { gap: number; atMs: number } | null = null
  private observed: StopObservation[] = []
  private offPathSince: number | null = null
  private divergedBefore: string | null = null
  private position: LngLat | null = null
  private positionMs: number | null = null

  /** `stops` run from the boarding stop to the alighting one. */
  constructor(private readonly stops: RideStop[]) {}

  update(sample: RideSample) {
    const dt = this.lastMs == null ? 0 : sample.nowMs - this.lastMs
    this.lastMs = sample.nowMs
    this.position = sample.position
    this.positionMs = sample.nowMs
    const board = this.stops[0]
    if (!board) return
    if (this.boardedAtMs == null) {
      if (sample.s <= board.s + AT_STOP_METERS) this.lastAtBoardMs = sample.nowMs
      if (sample.snapped && sample.s > board.s + BOARDED_METERS && sample.speed >= VEHICLE_SPEED) {
        this.boardedAtMs = this.lastAtBoardMs ?? sample.nowMs
      }
      return
    }
    this.watchPath(sample)
    if (sample.snapped) this.watchStops(sample, dt)
  }

  private watchPath(sample: RideSample) {
    if (sample.snapped) {
      this.offPathSince = null
      return
    }
    this.offPathSince ??= sample.nowMs
    if (sample.nowMs - this.offPathSince >= DIVERGED_MS) this.divergedBefore ??= this.stops[this.next]?.key ?? null
  }

  private watchStops(sample: RideSample, dt: number) {
    const last = this.stops.length - 1
    while (this.next < last && sample.s > this.stops[this.next].s + NEAR_STOP_METERS) {
      const stop = this.stops[this.next]
      this.observed.push({ stop: stop.key, atMs: this.closest?.atMs ?? sample.nowMs, dwelled: this.dwellMs >= DWELL_MS })
      this.next++
      this.dwellMs = 0
      this.closest = null
    }
    const stop = this.stops[this.next]
    if (this.next >= last || !stop) return
    const gap = Math.abs(sample.s - stop.s)
    if (gap > NEAR_STOP_METERS) return
    if (sample.speed < DWELL_SPEED) this.dwellMs += dt
    if (!this.closest || gap <= this.closest.gap) this.closest = { gap, atMs: sample.nowMs }
  }

  evidence(): RideEvidence {
    return {
      boardedAtMs: this.boardedAtMs,
      stops: [...this.observed],
      divergedBefore: this.divergedBefore,
      position: this.position,
      positionMs: this.positionMs,
    }
  }
}

export interface RankedCandidate {
  candidate: VehicleCandidate
  probability: number
}

const DEPARTURE_SIGMA_MS = 75_000
/** A vehicle can't have been boarded this long before it left, or this long after. */
const BOARDED_BEFORE_MS = 3 * 60_000
const BOARDED_AFTER_MS = 6 * 60_000
const CALL_SIGMA_MS = 120_000
const CALL_OFF_MS = 8 * 60_000
const POSITION_SIGMA_M = 600
const POSITION_OFF_M = 2500
const POSITION_FRESH_MS = 120_000
const PLANNED_PRIOR = 0.7
const DWELL_MATCH = 0.5
const PASS_MATCH = 0.3
const PASS_MISMATCH = -0.7

const gauss = (delta: number, sigma: number) => -((delta / sigma) ** 2) / 2

function logScore(candidate: VehicleCandidate, evidence: RideEvidence, known: Set<string>, plannedTripId: string | undefined, nowMs: number): number | null {
  let score = candidate.tripId === plannedTripId ? PLANNED_PRIOR : 0
  if (evidence.boardedAtMs != null) {
    const late = evidence.boardedAtMs - candidate.departureMs
    if (late < -BOARDED_BEFORE_MS || late > BOARDED_AFTER_MS) return null
    score += gauss(late, DEPARTURE_SIGMA_MS)
  }
  for (const seen of evidence.stops) {
    if (!known.has(seen.stop)) continue
    const call = candidate.calls.find(c => c.stop === seen.stop)
    if (!call) {
      if (seen.dwelled) return null
      score += PASS_MATCH
      continue
    }
    const off = seen.atMs - call.timeMs
    if (Math.abs(off) > CALL_OFF_MS) return null
    score += gauss(off, CALL_SIGMA_MS) + (seen.dwelled ? DWELL_MATCH : PASS_MISMATCH)
  }
  if (evidence.divergedBefore && candidate.calls.some(c => c.stop === evidence.divergedBefore)) return null
  const live = candidate.position
  if (live && evidence.position && nowMs - live.atMs < POSITION_FRESH_MS) {
    const apart = distanceMeters(live, evidence.position)
    if (apart > POSITION_OFF_M) return null
    score += gauss(apart, POSITION_SIGMA_M)
  }
  return score
}

/** The runs still possible, most likely first, with how likely each is. */
export function rankCandidates(set: CandidateSet, evidence: RideEvidence, plannedTripId: string | undefined, nowMs: number): RankedCandidate[] {
  const known = new Set(set.known)
  const scored = set.candidates.flatMap(candidate => {
    const score = logScore(candidate, evidence, known, plannedTripId, nowMs)
    return score == null ? [] : [{ candidate, score }]
  })
  if (!scored.length) return []
  const top = Math.max(...scored.map(s => s.score))
  const weights = scored.map(s => Math.exp(s.score - top))
  const total = weights.reduce((sum, w) => sum + w, 0)
  return scored.map((s, i) => ({ candidate: s.candidate, probability: weights[i] / total })).sort((a, b) => b.probability - a.probability)
}

export type VehicleVerdict =
  | { kind: 'unknown' }
  | { kind: 'settled'; candidate: VehicleCandidate }
  | { kind: 'ask'; options: RankedCandidate[] }

const SETTLED_PROBABILITY = 0.8
const PLAUSIBLE_PROBABILITY = 0.12
const MAX_OPTIONS = 3

export function vehicleVerdict(ranked: RankedCandidate[]): VehicleVerdict {
  const [best] = ranked
  if (!best) return { kind: 'unknown' }
  if (best.probability >= SETTLED_PROBABILITY) return { kind: 'settled', candidate: best.candidate }
  const options = ranked.filter(r => r.probability >= PLAUSIBLE_PROBABILITY).slice(0, MAX_OPTIONS)
  return options.length > 1 ? { kind: 'ask', options } : { kind: 'settled', candidate: best.candidate }
}

export interface RideSegment {
  startTime?: string | Date
  endTime?: string | Date
  duration?: number
  tripId?: string
  lineName?: string
  lineColor?: string | null
  lineTextColor?: string
  routeType?: number
  headsign?: string
  departureStop?: TransitStopInput
  arrivalStop?: TransitStopInput
  intermediateStops?: TransitStopInput[]
}

const toMs = (v?: string | Date) => (v ? new Date(v).getTime() : NaN)
const shifted = (v: string | Date | undefined, deltaMs: number) => (v ? new Date(toMs(v) + deltaMs).toISOString() : undefined)

/** The ride's fields once it is on `candidate`: its line, its times, and only the stops it calls at. */
export function retargetedRide(segment: RideSegment, candidate: VehicleCandidate, known: string[]): RideSegment {
  const delta = candidate.departureMs - toMs(segment.startTime)
  const knownStops = new Set(known)
  const callAt = (stop: TransitStopInput) => candidate.calls.find(c => c.stop === stopKey(stop))?.timeMs
  const intermediateStops = (segment.intermediateStops ?? []).flatMap(stop => {
    const time = callAt(stop)
    if (time == null && knownStops.has(stopKey(stop))) return []
    const at = time != null ? new Date(time).toISOString() : undefined
    return [{ ...stop, arrivalTime: at ?? shifted(stop.arrivalTime, delta), departureTime: at ?? shifted(stop.departureTime, delta) }]
  })
  const arrival = segment.arrivalStop
  const endMs = (arrival && callAt(arrival)) ?? toMs(segment.endTime) + delta
  return {
    tripId: candidate.tripId,
    lineName: candidate.line,
    lineColor: candidate.color,
    lineTextColor: candidate.textColor,
    routeType: candidate.routeType ?? segment.routeType,
    headsign: candidate.headsign ?? segment.headsign,
    startTime: new Date(candidate.departureMs),
    endTime: new Date(endMs),
    duration: Math.max(0, (endMs - candidate.departureMs) / 1000),
    departureStop: segment.departureStop && { ...segment.departureStop, departureTime: new Date(candidate.departureMs).toISOString() },
    arrivalStop: arrival && { ...arrival, arrivalTime: new Date(endMs).toISOString() },
    intermediateStops,
  }
}
