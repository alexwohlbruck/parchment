/**
 * Insert interpolated points so no segment of a polyline exceeds `maxMeters`.
 *
 * GTFS subway shapes are sparse — consecutive points can be over a kilometre
 * apart. When such a line is handed to a Mapbox/MapLibre geojson source, the
 * internal geojson→tile step can drop a long segment that crosses a tile
 * containing no vertices, breaking the rendered line into visible gaps.
 * Densifying guarantees every tile the line passes through contains vertices,
 * so the full line always renders. Interpolation is linear (lng/lat) — fine
 * at these distances and only adds collinear points, never changing the path.
 */
export function densifyLine(
  coordinates: [number, number][],
  maxMeters = 120,
): [number, number][] {
  if (coordinates.length < 2) return coordinates
  const out: [number, number][] = [coordinates[0]]
  for (let i = 1; i < coordinates.length; i++) {
    const [lng1, lat1] = coordinates[i - 1]
    const [lng2, lat2] = coordinates[i]
    const meters = haversineMeters(lat1, lng1, lat2, lng2)
    if (meters > maxMeters) {
      const steps = Math.ceil(meters / maxMeters)
      for (let s = 1; s < steps; s++) {
        const f = s / steps
        out.push([lng1 + (lng2 - lng1) * f, lat1 + (lat2 - lat1) * f])
      }
    }
    out.push(coordinates[i])
  }
  return out
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
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
