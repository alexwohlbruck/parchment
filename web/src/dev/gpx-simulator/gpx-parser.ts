/**
 * GPX track parser. Pure functions, no app dependencies.
 *
 * Extracts `<trkpt>` elements from a GPX 1.0 / 1.1 document and
 * synthesizes per-point speed (m/s) and heading (deg) by differencing
 * consecutive samples. Recorders sometimes include `speed` /
 * `course` extensions but most don't, so we always re-derive — gives
 * consistent values across sources.
 */

export interface GpxPoint {
  lat: number
  lng: number
  /** ms since epoch (recording wall-clock). */
  time: number
  altitude: number | null
  /** m/s, derived from this point to the next. 0 for last point. */
  speed: number
  /** Degrees, 0=N, 90=E. null when undefined (last point, or sub-meter jitter). */
  heading: number | null
}

const EARTH_RADIUS_M = 6_371_000
const toRad = (d: number) => (d * Math.PI) / 180

function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const x =
    (toRad(b.lng) - toRad(a.lng)) * Math.cos(toRad((a.lat + b.lat) / 2))
  const y = toRad(b.lat) - toRad(a.lat)
  return Math.sqrt(x * x + y * y) * EARTH_RADIUS_M
}

function bearingDeg(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  const deg = (Math.atan2(y, x) * 180) / Math.PI
  return (deg + 360) % 360
}

export function parseGpx(text: string): GpxPoint[] {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  const parserError = doc.querySelector('parsererror')
  if (parserError) throw new Error('GPX parse error: ' + parserError.textContent)

  const trkpts = Array.from(doc.querySelectorAll('trkpt'))
  if (trkpts.length === 0) {
    throw new Error('No <trkpt> elements found in GPX')
  }

  const raw = trkpts.map((pt) => {
    const lat = parseFloat(pt.getAttribute('lat') ?? 'NaN')
    const lng = parseFloat(pt.getAttribute('lon') ?? 'NaN')
    const timeText = pt.querySelector('time')?.textContent
    const timeMs = timeText ? new Date(timeText).getTime() : NaN
    const eleText = pt.querySelector('ele')?.textContent
    const ele = eleText ? parseFloat(eleText) : NaN
    return {
      lat,
      lng,
      time: timeMs,
      altitude: Number.isFinite(ele) ? ele : null,
    }
  })

  // Drop malformed points up front.
  const valid = raw.filter(
    (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng),
  )
  if (valid.length === 0) {
    throw new Error('No valid <trkpt> coordinates in GPX')
  }

  // Normalize timestamps. If the GPX has no `<time>` elements (some
  // recorders skip them on export), synthesize evenly-spaced 1Hz samples.
  if (valid.every((p) => !Number.isFinite(p.time))) {
    valid.forEach((p, i) => {
      p.time = i * 1000
    })
  } else {
    // Some points have time, some don't — fill gaps by interpolation.
    let lastKnownTime: number | null = null
    let lastKnownIdx = 0
    valid.forEach((p, i) => {
      if (Number.isFinite(p.time)) {
        lastKnownTime = p.time
        lastKnownIdx = i
        return
      }
      // Find next known time
      let nextIdx = i + 1
      while (nextIdx < valid.length && !Number.isFinite(valid[nextIdx].time)) {
        nextIdx++
      }
      if (lastKnownTime != null && nextIdx < valid.length) {
        const span = valid[nextIdx].time - lastKnownTime
        const frac = (i - lastKnownIdx) / (nextIdx - lastKnownIdx)
        p.time = lastKnownTime + span * frac
      } else if (lastKnownTime != null) {
        // Trailing unknowns — extend at 1Hz
        p.time = lastKnownTime + (i - lastKnownIdx) * 1000
      } else {
        // Leading unknowns — count back from first known
        p.time = (valid[nextIdx]?.time ?? 0) - (nextIdx - i) * 1000
      }
    })
  }

  // Compute speed + heading by looking forward to the next sample.
  const points: GpxPoint[] = valid.map((p, i) => {
    const next = valid[i + 1]
    if (!next) {
      return { ...p, speed: 0, heading: null }
    }
    const dtSec = Math.max(0.001, (next.time - p.time) / 1000)
    const dM = distanceMeters(p, next)
    const speed = dM / dtSec
    // Sub-meter samples don't yield meaningful heading.
    const heading = dM < 1 ? null : bearingDeg(p, next)
    return { ...p, speed, heading }
  })

  return points
}

/** Total recording duration in seconds. */
export function trackDurationSec(points: GpxPoint[]): number {
  if (points.length < 2) return 0
  return (points[points.length - 1].time - points[0].time) / 1000
}

/** Find the latest point whose time <= `targetTime` (ms). */
export function pointAtTime(
  points: GpxPoint[],
  targetTime: number,
): GpxPoint | null {
  if (points.length === 0) return null
  if (targetTime <= points[0].time) return points[0]
  if (targetTime >= points[points.length - 1].time) {
    return points[points.length - 1]
  }
  // Binary search for cheap scrubbing on long tracks.
  let lo = 0
  let hi = points.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1
    if (points[mid].time <= targetTime) lo = mid
    else hi = mid - 1
  }
  return points[lo]
}
