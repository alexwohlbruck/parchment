/**
 * Placing a live vehicle on a route's stop list.
 *
 * Distances are compared, never reported, so the projection works in a
 * cheap equirectangular degree space rather than true metres.
 */
import type { TransitVehiclePosition } from '@/types/multimodal.types'
import type { RouteDetailStop, VehicleOnRoute } from '@/types/transit.types'

export function projectVehicleOnRoute(
  v: TransitVehiclePosition,
  stops: RouteDetailStop[],
  coordinates?: [number, number][] | null,
): VehicleOnRoute | null {
  if (stops.length < 2) return null

  // Project the vehicle onto the route shape to get its distance
  // along the route — this matches how the map renders the vehicle.
  const vehicleDist = projectOntoShape(
    v.position.lat, v.position.lng, coordinates, stops,
  )

  // Find which two stops bracket this distance
  let segStartIdx = 0
  for (let i = 0; i < stops.length - 1; i++) {
    if (vehicleDist >= stops[i].distanceAlongRoute) {
      segStartIdx = i
    }
  }
  const segEndIdx = Math.min(segStartIdx + 1, stops.length - 1)

  // Fraction between the two bracketing stops
  const segLen = stops[segEndIdx].distanceAlongRoute - stops[segStartIdx].distanceAlongRoute
  const frac = segLen > 0
    ? Math.max(0, Math.min(1, (vehicleDist - stops[segStartIdx].distanceAlongRoute) / segLen))
    : 0

  // Timeline position: equidistant stops, so use index-based fraction
  const indexFraction = (segStartIdx + frac) / Math.max(1, stops.length - 1)

  // Determine travel direction by comparing vehicle bearing to
  // the route segment bearing at this position
  const isForward = computeIsForward(
    v.bearing,
    stops[segStartIdx],
    stops[segEndIdx],
  )

  return {
    vehicleId: v.vehicleId,
    vehicle: v,
    nearestStopIndex: segEndIdx,
    fractionBetweenStops: frac,
    distanceAlongRoute: vehicleDist,
    routeFraction: Math.max(0, Math.min(1, indexFraction)),
    isForwardDirection: isForward,
  }
}

/** Compare vehicle bearing to the segment bearing to determine travel direction. */
export function computeIsForward(
  vehicleBearing: number | undefined,
  fromStop: RouteDetailStop,
  toStop: RouteDetailStop,
): boolean {
  if (vehicleBearing == null) return true // assume forward if no bearing

  // Bearing from fromStop → toStop (the "forward" direction of the route)
  const segBearing = Math.atan2(
    toStop.lng - fromStop.lng,
    toStop.lat - fromStop.lat,
  ) * 180 / Math.PI
  const normalizedSeg = ((segBearing % 360) + 360) % 360

  // Angular difference
  let diff = Math.abs(vehicleBearing - normalizedSeg)
  if (diff > 180) diff = 360 - diff

  // < 90° means same direction as stop ordering = forward
  return diff < 90
}

/**
 * Project a vehicle position onto the route shape to get distance
 * along the route. Falls back to nearest-stop distance if no shape.
 */
export function projectOntoShape(
  lat: number,
  lng: number,
  coordinates: [number, number][] | null | undefined,
  stops: RouteDetailStop[],
): number {
  if (coordinates && coordinates.length >= 2) {
    // Build cumulative distances along the shape
    let cumDist = 0
    let bestDist = Infinity
    let bestAlong = 0

    for (let i = 0; i < coordinates.length - 1; i++) {
      const [aLng, aLat] = coordinates[i]
      const [bLng, bLat] = coordinates[i + 1]
      const segLen = haversineQuick(aLat, aLng, bLat, bLng)

      // Project point onto segment
      const dx = bLng - aLng
      const dy = bLat - aLat
      const lenSq = dx * dx + dy * dy
      const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((lng - aLng) * dx + (lat - aLat) * dy) / lenSq))

      const projLat = aLat + dy * t
      const projLng = aLng + dx * t
      const d = haversineQuick(lat, lng, projLat, projLng)

      if (d < bestDist) {
        bestDist = d
        bestAlong = cumDist + segLen * t
      }
      cumDist += segLen
    }

    // Convert shape distance to stop distance scale
    // (shape coordinates and stops use the same distance metric from Barrelman)
    const totalShapeDist = cumDist
    const totalStopDist = stops[stops.length - 1].distanceAlongRoute - stops[0].distanceAlongRoute
    if (totalShapeDist > 0 && totalStopDist > 0) {
      return stops[0].distanceAlongRoute + (bestAlong / totalShapeDist) * totalStopDist
    }
    return bestAlong
  }

  // Fallback: find nearest stop
  let bestIdx = 0
  let bestD = Infinity
  for (let i = 0; i < stops.length; i++) {
    const d = haversineQuick(lat, lng, stops[i].lat, stops[i].lng)
    if (d < bestD) { bestD = d; bestIdx = i }
  }
  return stops[bestIdx].distanceAlongRoute
}

function haversineQuick(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = lat2 - lat1
  const dLng = (lng2 - lng1) * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180)
  return Math.sqrt(dLat * dLat + dLng * dLng)
}
