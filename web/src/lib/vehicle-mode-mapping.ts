import type { VehicleType } from '@/types/multimodal.types'

/**
 * Maps vehicle types to their routing mode.
 * Mirrors server/src/lib/vehicle-mode-mapping.ts.
 */
export const VEHICLE_ROUTING_MODE: Record<VehicleType, 'driving' | 'biking'> = {
  car: 'driving',
  truck: 'driving',
  moped: 'driving',
  bike: 'biking',
  'e-bike': 'biking',
  scooter: 'biking',
  'e-scooter': 'biking',
  wheelchair: 'driving',
}

/**
 * Get the routing mode for a given vehicle type.
 */
export function getRoutingMode(vehicleType: string): 'driving' | 'biking' {
  return VEHICLE_ROUTING_MODE[vehicleType as VehicleType] ?? 'driving'
}

/**
 * Display names for vehicle types.
 */
export const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = {
  car: 'Car',
  truck: 'Truck',
  moped: 'Moped',
  bike: 'Bike',
  'e-bike': 'E-bike',
  scooter: 'Scooter',
  'e-scooter': 'E-scooter',
  wheelchair: 'Wheelchair',
}

/**
 * Lucide icon names for vehicle types.
 */
export const VEHICLE_TYPE_ICONS: Record<VehicleType, string> = {
  car: 'car',
  truck: 'truck',
  moped: 'bike', // No moped icon in lucide, use bike
  bike: 'bike',
  'e-bike': 'zap',
  scooter: 'bike',
  'e-scooter': 'zap',
  wheelchair: 'accessibility',
}
