/** Placing a live vehicle on a route's stop list. */
import {
  bearingDeg,
  buildPolylineDistances,
  distanceMeters,
  snapToPolyline,
} from '@/lib/map/movement-interpolation'
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

  const segBearing = bearingDeg(fromStop, toStop)

  let diff = Math.abs(vehicleBearing - segBearing)
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
    const polyline = coordinates.map(([x, y]) => ({ lat: y, lng: x }))
    const { cumulativeDistances, totalLength } = buildPolylineDistances(polyline)
    const { fraction } = snapToPolyline(
      { lat, lng }, polyline, cumulativeDistances, totalLength,
    )
    const first = stops[0].distanceAlongRoute
    const span = stops[stops.length - 1].distanceAlongRoute - first
    return span > 0 ? first + fraction * span : fraction * totalLength
  }

  let bestIdx = 0
  let bestD = Infinity
  for (let i = 0; i < stops.length; i++) {
    const d = distanceMeters({ lat, lng }, stops[i])
    if (d < bestD) { bestD = d; bestIdx = i }
  }
  return stops[bestIdx].distanceAlongRoute
}
