// A trip laid out along its timeline: one bar per leg, and the ground the traveller climbs on the legs they power.

import { haversineMeters } from '@/lib/geo/geo-line'
import { headsUpHazards } from './leg-heads-up'
import type { RouteHazard } from '@/types/directions.types'

/** Less climbing than this across the trip, and the profile is a flat line not worth the room. */
export const MIN_PROFILE_GAIN_METERS = 10
/** The profile never stretches less height than this, so a gentle street doesn't read as a mountain. */
const MIN_PROFILE_RANGE_METERS = 15
/** A walk across a station forecourt has no hill worth drawing, and its elevation data is often noise. */
const MIN_PROFILE_SECONDS = 180
const SMOOTH_WINDOW = 5
/** Profile samples per unit of strip width. */
const SAMPLES_PER_WIDTH = 140

export interface StripSegment {
  mode: string
  startTime: Date | string
  endTime: Date | string
  duration: number
  waitSeconds?: number
  distance?: number
  lineColor?: string | null
  geometry?: { lat: number; lng: number; elevation?: number }[] | unknown
  totalElevationGain?: number
  hazards?: RouteHazard[]
}

export interface StripLeg {
  index: number
  mode: string
  lineColor?: string | null
  /** Start, end of the moving part, and end including any wait, as fractions of the trip. */
  x0: number
  x1: number
  xEnd: number
}

export interface StripProfile {
  index: number
  /** x along the strip and y in 0–1, 1 the highest ground on the trip. */
  points: { x: number; y: number }[]
}

export interface TripStripModel {
  legs: StripLeg[]
  profiles: StripProfile[]
  markers: { index: number; x: number; kind: RouteHazard['kind'] }[]
}

const selfPowered = (mode: string) => mode === 'walking' || mode === 'cycling' || mode === 'biking'
const profiled = (s: StripSegment) => selfPowered(s.mode) && s.duration - (s.waitSeconds ?? 0) >= MIN_PROFILE_SECONDS

function elevationTrack(geometry: StripSegment['geometry']): { d: number; e: number }[] {
  if (!Array.isArray(geometry)) return []
  const track: { d: number; e: number }[] = []
  let d = 0
  geometry.forEach((p, i) => {
    if (i > 0) d += haversineMeters(geometry[i - 1].lat, geometry[i - 1].lng, p.lat, p.lng)
    if (typeof p.elevation === 'number') track.push({ d, e: p.elevation })
  })
  return track
}

function smooth(track: { d: number; e: number }[]): { d: number; e: number }[] {
  const half = Math.floor(SMOOTH_WINDOW / 2)
  return track.map((p, i) => {
    const window = track.slice(Math.max(0, i - half), i + half + 1)
    return { d: p.d, e: window.reduce((sum, q) => sum + q.e, 0) / window.length }
  })
}

/** Elevation at distance `d`, interpolated along an ordered track. */
function sample(track: { d: number; e: number }[], d: number): number {
  const after = track.findIndex(p => p.d >= d)
  if (after <= 0) return after === 0 ? track[0].e : track.at(-1)!.e
  const a = track[after - 1]
  const b = track[after]
  return a.e + ((d - a.d) / (b.d - a.d || 1)) * (b.e - a.e)
}

export function tripStrip(segments: StripSegment[]): TripStripModel {
  if (!segments.length) return { legs: [], profiles: [], markers: [] }
  const t0 = new Date(segments[0].startTime).getTime()
  const span = new Date(segments.at(-1)!.endTime).getTime() - t0 || 1
  const at = (date: Date | string) => (new Date(date).getTime() - t0) / span

  const legs: StripLeg[] = segments.map((segment, index) => {
    const x0 = at(segment.startTime)
    const xEnd = at(segment.endTime)
    const moving = Math.max(0, segment.duration - (segment.waitSeconds ?? 0)) * 1000 / span
    return { index, mode: segment.mode, lineColor: segment.lineColor, x0, x1: Math.min(xEnd, x0 + moving), xEnd }
  })

  const markers = segments.flatMap((segment, index) => {
    if (!selfPowered(segment.mode) || !segment.distance) return []
    const leg = legs[index]
    return headsUpHazards(segment).map(h => ({ index, kind: h.kind, x: leg.x0 + (h.startDistance / segment.distance!) * (leg.x1 - leg.x0) }))
  })

  const gain = segments.reduce((sum, s) => sum + (profiled(s) ? s.totalElevationGain ?? 0 : 0), 0)
  if (gain < MIN_PROFILE_GAIN_METERS) return { legs, profiles: [], markers }

  const tracks = segments.map(s => (profiled(s) ? smooth(elevationTrack(s.geometry)) : []))
  const all = tracks.flat().map(p => p.e)
  if (!all.length) return { legs, profiles: [], markers }
  const lo = Math.min(...all)
  const range = Math.max(Math.max(...all) - lo, MIN_PROFILE_RANGE_METERS)

  const profiles = tracks.flatMap((track, index) => {
    if (track.length < 2) return []
    const leg = legs[index]
    const length = track.at(-1)!.d
    const n = Math.max(6, Math.round((leg.x1 - leg.x0) * SAMPLES_PER_WIDTH))
    const points = Array.from({ length: n + 1 }, (_, k) => {
      const f = k / n
      return { x: leg.x0 + f * (leg.x1 - leg.x0), y: (sample(track, f * length) - lo) / range }
    })
    return [{ index, points }]
  })
  return { legs, profiles, markers }
}

/** Where on the strip a traveller `offset` metres into segment `index` is. */
export function stripX(model: TripStripModel, segments: StripSegment[], index: number, offset: number): number {
  const leg = model.legs[index]
  if (!leg) return 0
  const distance = segments[index]?.distance
  const f = distance ? Math.min(1, Math.max(0, offset / distance)) : 0
  return leg.x0 + f * (leg.x1 - leg.x0)
}
