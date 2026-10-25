// Whether a fresh transit plan from where the rider is now gets them there
// clearly sooner than the one they are following.

import type { LngLat } from '@/types/map.types'

export interface ItinerarySegment {
  mode: string
  ownership?: string
  endTime?: string | Date
  geometry?: LngLat[]
  tripId?: string
  lineName?: string
}

export interface Itinerary<S extends ItinerarySegment = ItinerarySegment> {
  segments: S[]
  endTime: string | Date
}

export interface ItineraryOffer<T> {
  itinerary: T
  /** Milliseconds sooner it arrives. */
  gainMs: number
  /** The lines it rides, in order. */
  lines: string[]
}

export const ITINERARY_CHECK_MS = 120_000
const MIN_GAIN_MS = 3 * 60_000
const MIN_GAIN_SHARE = 0.1
const OWN_LEGS = new Set(['walking', 'transit'])

const ms = (v?: string | Date) => (v ? new Date(v).getTime() : NaN)

/** A ride with nothing personal to bring along, a bike or a car, so another transit plan can replace it wholesale. */
export function isTransitOnly(segments: ItinerarySegment[]): boolean {
  return segments.some(s => s.mode === 'transit') && segments.every(s => OWN_LEGS.has(s.mode) || s.ownership === 'shared')
}

/** Each ride by its vehicle run, each other leg by its mode: the same plan found again has the same one. */
function signature(segments: ItinerarySegment[]): string {
  return segments.map(s => (s.mode === 'transit' ? s.tripId ?? s.lineName ?? '' : s.mode)).join('|')
}

/** The candidate worth interrupting for, if any; `remaining` is the rest of the plan being followed. */
export function chooseItinerary<T extends Itinerary>(remaining: ItinerarySegment[], candidates: T[], nowMs: number): ItineraryOffer<T> | null {
  const plannedEnd = ms(remaining.at(-1)?.endTime)
  if (!Number.isFinite(plannedEnd) || !isTransitOnly(remaining)) return null
  const needed = Math.max(MIN_GAIN_MS, MIN_GAIN_SHARE * (plannedEnd - nowMs))
  const current = signature(remaining)
  let best: ItineraryOffer<T> | null = null
  for (const candidate of candidates) {
    const segments = candidate.segments
    if (!isTransitOnly(segments) || segments.some(s => (s.geometry?.length ?? 0) < 2)) continue
    if (signature(segments) === current) continue
    const gainMs = plannedEnd - ms(candidate.endTime)
    if (gainMs >= needed && (!best || gainMs > best.gainMs)) {
      best = { itinerary: candidate, gainMs, lines: segments.filter(s => s.mode === 'transit').map(s => s.lineName ?? '') }
    }
  }
  return best
}
