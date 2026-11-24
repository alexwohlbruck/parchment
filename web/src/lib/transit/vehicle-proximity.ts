import { haversineMeters } from '@/lib/geo/geo-line'

interface PositionedVehicle {
  vehicleId: string
  vehicle: { position: { lat: number; lng: number } }
}

export interface VehicleProximity {
  distances: Map<string, number>
  closestId: string | null
}

export function vehicleProximity(
  vehicles: PositionedVehicle[],
  from: { lat: number; lng: number } | null,
): VehicleProximity {
  const distances = new Map<string, number>()
  if (!from) return { distances, closestId: null }

  let closestId: string | null = null
  let closest = Infinity
  for (const { vehicleId, vehicle } of vehicles) {
    const meters = haversineMeters(from.lat, from.lng, vehicle.position.lat, vehicle.position.lng)
    distances.set(vehicleId, meters)
    if (meters < closest) {
      closest = meters
      closestId = vehicleId
    }
  }
  return { distances, closestId }
}
