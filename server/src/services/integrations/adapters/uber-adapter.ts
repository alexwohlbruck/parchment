/**
 * Uber API response → RideshareProduct adapter.
 *
 * Maps Uber's estimates/price and estimates/time responses to the
 * unified RideshareProduct interface.
 */

import type { RideshareProduct } from '../../../types/integration.types'

interface UberPriceEstimate {
  product_id: string
  display_name: string
  estimate: string // "$12-16"
  low_estimate: number
  high_estimate: number
  currency_code: string
  surge_multiplier?: number
  duration: number // seconds
  distance: number // miles
}

interface UberTimeEstimate {
  product_id: string
  display_name: string
  estimate: number // seconds
}

/**
 * Merge Uber price + time estimates into unified products.
 */
export function adaptUberEstimates(
  prices: UberPriceEstimate[],
  times: UberTimeEstimate[],
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
): RideshareProduct[] {
  const timeByProduct = new Map(times.map(t => [t.product_id, t.estimate]))

  return prices
    .filter(p => p.low_estimate != null && p.high_estimate != null)
    .map(p => ({
      productId: p.product_id,
      displayName: p.display_name,
      estimatedPrice: {
        low: { value: p.low_estimate, currency: p.currency_code },
        high: { value: p.high_estimate, currency: p.currency_code },
        surgeMultiplier: p.surge_multiplier,
      },
      estimatedPickupTime: timeByProduct.get(p.product_id) ?? 300,
      estimatedDuration: p.duration,
      estimatedDistance: Math.round(p.distance * 1609.34), // miles → meters
      bookingUrl: buildUberDeepLink(origin, destination, p.product_id),
      capacity: getUberCapacity(p.display_name),
    }))
}

function buildUberDeepLink(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  productId: string,
): string {
  const params = new URLSearchParams({
    'action': 'setPickup',
    'pickup[latitude]': String(origin.lat),
    'pickup[longitude]': String(origin.lng),
    'dropoff[latitude]': String(destination.lat),
    'dropoff[longitude]': String(destination.lng),
    'product_id': productId,
  })
  return `https://m.uber.com/ul/?${params}`
}

function getUberCapacity(displayName: string): number {
  const lower = displayName.toLowerCase()
  if (lower.includes('xl') || lower.includes('suv')) return 6
  if (lower.includes('black')) return 4
  return 4
}
