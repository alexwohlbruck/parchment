// Hazards a street segment passes through, read off the edge attributes the
// router already returns plus the route's own shape. Pure, so the same rules
// run for planning, rerouting and tests.

import type {
  Coordinate,
  RouteEdgeSegment,
  RouteHazard,
  RouteHazardKind,
  RouteInstruction,
} from '../types/unified-routing.types'

export interface HazardSegment {
  mode: string
  geometry?: Coordinate[] | null
  edgeSegments?: RouteEdgeSegment[]
  instructions?: RouteInstruction[]
}

const PREMIUM_KINDS = new Set<RouteHazardKind>(['rough_surface', 'dismount', 'ferry'])

/** Whether a kind is gated; everything that warns of risk to someone stays free. */
export function isPremiumHazard(kind: RouteHazardKind): boolean {
  return PREMIUM_KINDS.has(kind)
}

const ROUGH_SURFACES = new Set(['gravel', 'dirt', 'sand', 'ground', 'grass', 'unpaved', 'mud', 'cobblestone', 'sett', 'pebblestone'])
const ROUGH_SMOOTHNESS = new Set(['bad', 'very_bad', 'horrible', 'very_horrible', 'impassable'])
/** Grades are for people under their own power; a car's climb isn't a hazard. */
const STEEP_GRADE: Record<string, number> = { walking: 10, cycling: 7 }
/** Elevation models are surface models: buildings make city blocks look like cliffs over short runs. */
const GRADE_WINDOW_METERS = 200
const GRADE_SAMPLE_METERS = 25

const SHARP_CURVE_DEG = 60
const CURVE_PROBE_METERS = 15
const CURVE_SAMPLE_METERS = 10
const MANEUVER_CLEARANCE_METERS = 30

const R = 6371000
function haversine(a: Coordinate, b: Coordinate): number {
  const toRad = Math.PI / 180
  const dLat = (b.lat - a.lat) * toRad
  const dLng = (b.lng - a.lng) * toRad
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

function bearing(a: Coordinate, b: Coordinate): number {
  const toRad = Math.PI / 180
  const y = Math.sin((b.lng - a.lng) * toRad) * Math.cos(b.lat * toRad)
  const x =
    Math.cos(a.lat * toRad) * Math.sin(b.lat * toRad) -
    Math.sin(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.cos((b.lng - a.lng) * toRad)
  return (Math.atan2(y, x) * 180) / Math.PI
}

/** First index in [lo, hi) whose value is >= target (or > target when `after`), else hi. */
function search(values: number[], target: number, lo: number, hi: number, after = false): number {
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (after ? values[mid] <= target : values[mid] < target) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** A polyline with lookups by distance along it. */
function measure(geometry: Coordinate[]) {
  const cumulative = [0]
  for (let i = 1; i < geometry.length; i++) cumulative.push(cumulative[i - 1] + haversine(geometry[i - 1], geometry[i]))
  const length = cumulative[cumulative.length - 1] ?? 0
  /** End index of the span holding distance d. */
  const spanAt = (d: number) => search(cumulative, d, 1, Math.max(1, cumulative.length - 1))
  const at = (d: number): Coordinate => {
    if (geometry.length === 0) return { lat: 0, lng: 0 }
    const target = Math.min(Math.max(0, d), length)
    const i = spanAt(target)
    const span = cumulative[i] - cumulative[i - 1] || 1
    const t = Math.min(1, Math.max(0, (target - cumulative[i - 1]) / span))
    const a = geometry[i - 1]
    const b = geometry[i] ?? a
    return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t }
  }
  return { length, at, spanAt, cumulative }
}

function crossingHazard(mode: string, crossing: string): { kind: RouteHazardKind; severity: RouteHazard['severity'] } | null {
  switch (crossing) {
    case 'railway':
    case 'railway_barrier':
      return { kind: 'rail_crossing', severity: crossing === 'railway' ? 'high' : 'medium' }
    case 'traffic_signals':
      return { kind: 'traffic_signals', severity: 'low' }
    case 'uncontrolled':
      return mode === 'driving'
        ? { kind: 'crosswalk', severity: 'high' }
        : { kind: 'uncontrolled_crossing', severity: 'high' }
    case 'marked':
    case 'unmarked':
      return { kind: 'crosswalk', severity: mode === 'driving' ? 'high' : 'medium' }
    default:
      return null
  }
}

function edgeHazards(segment: HazardSegment, at: (d: number) => Coordinate): RouteHazard[] {
  const hazards: RouteHazard[] = []
  const push = (edge: RouteEdgeSegment, kind: RouteHazardKind, severity: RouteHazard['severity'], options: { stretch?: boolean; variant?: string } = {}) => {
    hazards.push({
      kind,
      severity,
      startDistance: edge.startDistance,
      ...(options.stretch && { endDistance: edge.endDistance }),
      coordinate: at(edge.startDistance),
      ...(options.variant && { variant: options.variant }),
      ...(isPremiumHazard(kind) && { premium: true }),
    })
  }

  for (const edge of segment.edgeSegments ?? []) {
    if (edge.crossing) {
      const crossing = crossingHazard(segment.mode, edge.crossing.toLowerCase())
      if (crossing) push(edge, crossing.kind, crossing.severity, { variant: edge.crossing.toLowerCase() })
    }
    switch (edge.roadEnvironment) {
      case 'tunnel':
        if (segment.mode !== 'walking') push(edge, 'tunnel', 'low', { stretch: true })
        break
      case 'ford':
        push(edge, 'ford', 'high')
        break
      case 'ferry':
        push(edge, 'ferry', 'low', { stretch: true })
        break
    }
    if (edge.roadClass === 'steps' && segment.mode !== 'driving') push(edge, 'steps', 'medium', { stretch: true })
    if ((edge.roadClass === 'living_street' || edge.roadClass === 'pedestrian') && segment.mode !== 'walking') {
      push(edge, 'shared_space', 'medium', { stretch: true })
    }
    if (segment.mode === 'cycling' && edge.getOffBike) push(edge, 'dismount', 'low', { stretch: true })
    if (segment.mode !== 'walking' && ((edge.surface && ROUGH_SURFACES.has(edge.surface)) || (edge.smoothness && ROUGH_SMOOTHNESS.has(edge.smoothness)))) {
      push(edge, 'rough_surface', 'low', { stretch: true, variant: edge.surface })
    }
  }
  return mergeAdjacent(hazards, at)
}

/** A crossing node sits between two edges, so one crossing can arrive twice. */
const SAME_POINT_METERS = 25
/** OSM signals each crosswalk of a junction, so one junction reads as a light on either side of it. */
const SIGNAL_JUNCTION_METERS = 45

/** Edges come in short runs; one stretch, or one crossing, of the same hazard reads as one. */
function mergeAdjacent(hazards: RouteHazard[], at: (d: number) => Coordinate): RouteHazard[] {
  const merged: RouteHazard[] = []
  const firstAt = new Map<RouteHazard, number>()
  for (const hazard of hazards) {
    const last = merged.findLast((h) => h.kind === hazard.kind)
    if (last && last.endDistance != null && hazard.endDistance != null && hazard.startDistance - last.endDistance < 1) {
      last.endDistance = hazard.endDistance
      continue
    }
    if (last && last.endDistance == null && hazard.endDistance == null) {
      const first = firstAt.get(last) ?? last.startDistance
      if (hazard.kind === 'traffic_signals' && hazard.startDistance - first < SIGNAL_JUNCTION_METERS) {
        firstAt.set(last, first)
        last.startDistance = (first + hazard.startDistance) / 2
        last.coordinate = at(last.startDistance)
        continue
      }
      if (hazard.startDistance - first < SAME_POINT_METERS) continue
    }
    merged.push(hazard)
  }
  return merged
}

/**
 * Sustained grades from the route's elevation profile, smoothed and judged over
 * windows long enough that surface-model noise averages out.
 */
function steepGrades(segment: HazardSegment, path: ReturnType<typeof measure>): RouteHazard[] {
  const geometry = segment.geometry ?? []
  const threshold = STEEP_GRADE[segment.mode]
  if (!threshold || path.length < GRADE_WINDOW_METERS * 2) return []
  // An elevation of exactly 0 is the model's "no data" (tunnels, gaps), not sea level.
  const known = (i: number) => geometry[i]?.elevation != null && geometry[i].elevation !== 0
  const unknownBefore = [0]
  for (let i = 0; i < geometry.length; i++) unknownBefore.push(unknownBefore[i] + (known(i) ? 0 : 1))
  const coveredBetween = (from: number, to: number) => {
    const first = search(path.cumulative, from, 0, geometry.length)
    const end = search(path.cumulative, to, first, geometry.length, true)
    return unknownBefore[end] === unknownBefore[first]
  }
  /** Smoothing windows overlap on the sample grid, so each grid point is read many times. */
  const elevations = new Map<number, number>()
  const elevationAt = (d: number) => {
    const cached = elevations.get(d)
    if (cached !== undefined) return cached
    const i = path.spanAt(d)
    const span = path.cumulative[i] - path.cumulative[i - 1] || 1
    const t = Math.min(1, Math.max(0, (d - path.cumulative[i - 1]) / span))
    const elevation = geometry[i - 1].elevation! + (geometry[i].elevation! - geometry[i - 1].elevation!) * t
    elevations.set(d, elevation)
    return elevation
  }
  const smoothed = (d: number) => {
    let total = 0
    let n = 0
    for (let x = d - GRADE_WINDOW_METERS / 2; x <= d + GRADE_WINDOW_METERS / 2; x += GRADE_SAMPLE_METERS) {
      total += elevationAt(Math.min(path.length, Math.max(0, x)))
      n++
    }
    return total / n
  }

  const grades: RouteHazard[] = []
  let open: RouteHazard | null = null
  for (let d = 0; d + GRADE_WINDOW_METERS <= path.length; d += GRADE_SAMPLE_METERS) {
    if (!coveredBetween(d - GRADE_WINDOW_METERS / 2, d + GRADE_WINDOW_METERS * 1.5)) {
      open = null
      continue
    }
    const grade = ((smoothed(d + GRADE_WINDOW_METERS) - smoothed(d)) / GRADE_WINDOW_METERS) * 100
    if (Math.abs(grade) >= threshold) {
      if (open && Math.sign(Number(open.variant)) === Math.sign(grade)) {
        open.endDistance = d + GRADE_WINDOW_METERS
        if (Math.abs(grade) > Math.abs(Number(open.variant))) open.variant = String(Math.round(grade))
      } else {
        open = { kind: 'steep_grade', severity: 'medium', startDistance: d, endDistance: d + GRADE_WINDOW_METERS, coordinate: path.at(d), variant: String(Math.round(grade)) }
        grades.push(open)
      }
      if (Math.abs(grade) >= threshold * 1.5) open.severity = 'high'
    } else {
      open = null
    }
  }
  return grades
}

/**
 * Index of the first sample closest to a point. Samples are at most a step apart, so
 * a sample `gap` away rules out the next (gap - best) / step as any closer.
 */
function nearestSample(samples: Coordinate[], point: Coordinate): number {
  const step = 2 * CURVE_SAMPLE_METERS
  let best = 0
  let bestGap = Infinity
  const consider = (k: number) => {
    const gap = haversine(samples[k], point)
    if (gap < bestGap || (gap === bestGap && k < best)) {
      bestGap = gap
      best = k
    }
    return gap
  }
  const stride = Math.ceil(Math.sqrt(samples.length))
  for (let k = 0; k < samples.length; k += stride) consider(k)
  for (let k = 0; k < samples.length; ) {
    const gap = consider(k)
    k += Math.max(1, Math.floor((gap - bestGap) / step))
  }
  return best
}

/** Bends sharp enough to slow for that aren't themselves a turn instruction. */
function sharpCurves(segment: HazardSegment, path: ReturnType<typeof measure>): RouteHazard[] {
  if (segment.mode === 'walking' || path.length < CURVE_PROBE_METERS * 3) return []
  const samples: Coordinate[] = []
  for (let d = 0; d <= path.length; d += CURVE_SAMPLE_METERS) samples.push(path.at(d))
  const maneuvers = (segment.instructions ?? [])
    .map((instruction) => nearestSample(samples, instruction.coordinate) * CURVE_SAMPLE_METERS)
    .sort((a, b) => a - b)
  const nearManeuver = (d: number) => {
    const next = maneuvers[search(maneuvers, d - MANEUVER_CLEARANCE_METERS, 0, maneuvers.length, true)]
    return next !== undefined && next < d + MANEUVER_CLEARANCE_METERS
  }
  const curves: RouteHazard[] = []
  let lastCurve = -Infinity
  for (let d = CURVE_PROBE_METERS; d <= path.length - CURVE_PROBE_METERS; d += CURVE_SAMPLE_METERS) {
    const before = bearing(path.at(d - CURVE_PROBE_METERS), path.at(d))
    const after = bearing(path.at(d), path.at(d + CURVE_PROBE_METERS))
    const turn = Math.abs(((after - before + 540) % 360) - 180)
    if (turn < SHARP_CURVE_DEG || d - lastCurve < 60) continue
    if (nearManeuver(d)) continue
    lastCurve = d
    curves.push({ kind: 'sharp_curve', severity: turn >= 90 ? 'high' : 'medium', startDistance: d, coordinate: path.at(d), variant: String(Math.round(turn)) })
  }
  return curves
}

export function routeHazards(input: HazardSegment): RouteHazard[] {
  const geometry = input.geometry ?? []
  if (geometry.length < 2 || input.mode === 'transit') return []
  // Trip planning names the bike mode `biking`; everything here says `cycling`.
  const segment = { ...input, mode: input.mode === 'biking' ? 'cycling' : input.mode }
  const path = measure(geometry)
  return [...edgeHazards(segment, path.at), ...steepGrades(segment, path), ...sharpCurves(segment, path)].sort(
    (a, b) => a.startDistance - b.startDistance,
  )
}

/** Every street segment of a planning response gets its hazards; premium kinds only for members. */
export function attachHazards<T extends HazardSegment & { hazards?: RouteHazard[]; details?: any }>(
  segments: T[],
  { premium }: { premium: boolean },
): void {
  for (const segment of segments) {
    const nested = segment.details?.multimodalSegments as T[] | undefined
    if (nested?.length) attachHazards(nested, { premium })
    const hazards = routeHazards(segment)
    segment.hazards = premium ? hazards : hazards.filter((h) => !h.premium)
  }
}
