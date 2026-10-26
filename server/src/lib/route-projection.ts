// Where a point sits along a polyline, in metres from its start.

export interface LatLng {
  lat: number
  lng: number
}

const METERS_PER_DEGREE = 111_320

function metres(a: LatLng, b: LatLng): number {
  const cos = Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180))
  return Math.hypot((b.lng - a.lng) * cos, b.lat - a.lat) * METERS_PER_DEGREE
}

export function cumulativeDistances(line: LatLng[]): number[] {
  const out = [0]
  for (let i = 1; i < line.length; i++) out.push(out[i - 1] + metres(line[i - 1], line[i]))
  return out
}

/** Distance along `line` of the point nearest `p`, and how far off the line `p` is. */
export function projectAlong(line: LatLng[], p: LatLng, cumulative = cumulativeDistances(line)) {
  let best = { along: 0, offset: Infinity }
  const cos = Math.cos(p.lat * (Math.PI / 180))
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i]
    const b = line[i + 1]
    const dx = (b.lng - a.lng) * cos
    const dy = b.lat - a.lat
    const len2 = dx * dx + dy * dy
    const t = len2 > 0 ? Math.max(0, Math.min(1, (((p.lng - a.lng) * cos) * dx + (p.lat - a.lat) * dy) / len2)) : 0
    const q = { lat: a.lat + dy * t, lng: a.lng + (b.lng - a.lng) * t }
    const offset = metres(q, p)
    if (offset < best.offset) best = { along: cumulative[i] + (cumulative[i + 1] - cumulative[i]) * t, offset }
  }
  if (line.length === 1) best = { along: 0, offset: metres(line[0], p) }
  return best
}

/** The point `d` metres along `line`, clamped to its ends. */
export function pointAlong(line: LatLng[], d: number, cumulative = cumulativeDistances(line)): LatLng {
  if (line.length === 1 || d <= 0) return line[0]
  for (let i = 1; i < line.length; i++) {
    if (cumulative[i] >= d) {
      const span = cumulative[i] - cumulative[i - 1]
      const t = span > 0 ? (d - cumulative[i - 1]) / span : 0
      const a = line[i - 1]
      const b = line[i]
      return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t }
    }
  }
  return line[line.length - 1]
}
