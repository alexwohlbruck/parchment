/**
 * Lyft API response → RideshareProduct adapter.
 *
 * Maps Lyft's cost and ETA estimates to the unified RideshareProduct
 * interface.
 */

import type { RideshareProduct } from '../../../types/integration.types'

interface LyftCostEstimate {
  ride_type: string
  display_name: string
  estimated_cost_cents_min: number
  estimated_cost_cents_max: number
  currency: string
  estimated_duration_seconds: number
  estimated_distance_miles: number
  primetime_percentage?: string // "25%" format
}

interface LyftEtaEstimate {
  ride_type: string
  display_name: string
  eta_seconds: number
}

/**
 * Merge Lyft cost + ETA estimates into unified products.
 */
export function adaptLyftEstimates(
  costs: LyftCostEstimate[],
  etas: LyftEtaEstimate[],
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
): RideshareProduct[] {
  const etaByType = new Map(etas.map(e => [e.ride_type, e.eta_seconds]))

  return costs
    .filter(c => c.estimated_cost_cents_min != null)
    .map(c => {
      const primeTime = c.primetime_percentage
        ? parseInt(c.primetime_percentage, 10) / 100
        : 0
      const surgeMultiplier = 1 + primeTime

      return {
        productId: c.ride_type,
        displayName: c.display_name,
        estimatedPrice: {
          low: { value: c.estimated_cost_cents_min / 100, currency: c.currency },
          high: { value: c.estimated_cost_cents_max / 100, currency: c.currency },
          surgeMultiplier: surgeMultiplier > 1 ? surgeMultiplier : undefined,
        },
        estimatedPickupTime: etaByType.get(c.ride_type) ?? 300,
        estimatedDuration: c.estimated_duration_seconds,
        estimatedDistance: Math.round(c.estimated_distance_miles * 1609.34),
        bookingUrl: buildLyftDeepLink(origin, destination, c.ride_type),
        capacity: getLyftCapacity(c.ride_type),
      }
    })
}

function buildLyftDeepLink(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  rideType: string,
): string {
  const params = new URLSearchParams({
    'id': rideType,
    'pickup[latitude]': String(origin.lat),
    'pickup[longitude]': String(origin.lng),
    'destination[latitude]': String(destination.lat),
    'destination[longitude]': String(destination.lng),
  })
  return `lyft://ridetype?${params}`
}

function getLyftCapacity(rideType: string): number {
  if (rideType.includes('xl') || rideType.includes('suv')) return 6
  if (rideType.includes('lux')) return 4
  return 4
}
