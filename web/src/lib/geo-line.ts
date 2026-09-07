/**
 * Distance-along and slicing for [lng, lat] polylines.
 *
 * Both halves of one operation: find where along a line a point falls
 * (`projectAlong`), then cut the line between two such distances
 * (`sliceAlong`). Used to trim a route's shape to the span it is actually
 * running — the two calls share the same cumulative metric, so a slice
 * between two projected stops lands exactly on those stops regardless of
 * what units anyone else measured the line in.
 */

export function haversineMeters(
  lat1: number, lng1: number, lat2: number, lng2: number,
): number {
  const R = 6371000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

/**
 * Distance in metres along `coords` of the point on the line nearest `pt`.
 * Segments are treated as locally flat (equirectangular) for the
 * perpendicular projection, which is exact at these scales.
 */
export function projectAlong(
  coords: [number, number][],
  [plng, plat]: [number, number],
): number {
  let cum = 0
  let best = Infinity
  let bestAlong = 0
  for (let i = 1; i < coords.length; i++) {
    const [alng, alat] = coords[i - 1]
    const [blng, blat] = coords[i]
    const segLen = haversineMeters(alat, alng, blat, blng)
    const kx = 111_320 * Math.cos((alat * Math.PI) / 180)
    const ky = 110_540
    const dx = (blng - alng) * kx
    const dy = (blat - alat) * ky
    const px = (plng - alng) * kx
    const py = (plat - alat) * ky
    const len2 = dx * dx + dy * dy
    const t = len2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / len2)) : 0
    const ddx = px - t * dx
    const ddy = py - t * dy
    const d2 = ddx * ddx + ddy * ddy
    if (d2 < best) {
      best = d2
      bestAlong = cum + segLen * t
    }
    cum += segLen
  }
  return bestAlong
}

/**
 * The sub-polyline between two distances (metres) along `coords`, with both
 * cut ends interpolated exactly. Out-of-range bounds clamp to the line's
 * ends; an empty or inverted span returns an empty array.
 */
export function sliceAlong(
  coords: [number, number][],
  from: number,
  to: number,
): [number, number][] {
  if (coords.length < 2 || to <= from) return []
  const lerp = (
    a: [number, number], b: [number, number], f: number,
  ): [number, number] => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]

  const out: [number, number][] = []
  let cum = 0
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1]
    const b = coords[i]
    const segLen = haversineMeters(a[1], a[0], b[1], b[0])
    const end = cum + segLen
    if (end > from && cum < to) {
      if (!out.length) {
        out.push(segLen ? lerp(a, b, Math.max(0, (from - cum) / segLen)) : a)
      }
      if (end >= to) {
        out.push(segLen ? lerp(a, b, Math.min(1, (to - cum) / segLen)) : b)
        return out
      }
      out.push(b)
    }
    cum = end
  }
  return out
}
