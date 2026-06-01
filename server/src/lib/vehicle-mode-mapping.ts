import type { VehicleType } from '../types/trip.types'

/**
 * Maps vehicle types to their routing mode.
 * Used to enforce "one active vehicle per routing mode" constraint.
 */
export const VEHICLE_ROUTING_MODE: Record<VehicleType, 'driving' | 'biking'> = {
  car: 'driving',
  truck: 'driving',
  moped: 'driving',
  bike: 'biking',
  'e-bike': 'biking',
  scooter: 'biking',
  'e-scooter': 'biking',
  wheelchair: 'driving', // Uses road routing
}

/**
 * Get the routing mode for a given vehicle type.
 */
export function getRoutingMode(vehicleType: string): 'driving' | 'biking' {
  return VEHICLE_ROUTING_MODE[vehicleType as VehicleType] ?? 'driving'
}
