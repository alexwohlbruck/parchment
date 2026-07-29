/**
 * Unit tests for the Uber and Lyft response adapters.
 *
 * Both providers report prices and pickup times from separate endpoints, so
 * the adapters join them by product id — a mismatch has to fall back to a
 * default ETA rather than emitting `undefined` into a price card.
 *
 * The unit conversions are the other risk: Uber reports dollars and miles,
 * Lyft reports CENTS and miles, and the unified shape wants currency units
 * and metres. Getting the Lyft one wrong would show fares 100× too high.
 */

import { describe, test, expect } from 'bun:test'
import { adaptUberEstimates } from './uber-adapter'
import { adaptLyftEstimates } from './lyft-adapter'

const origin = { lat: 35.2, lng: -80.8 }
const destination = { lat: 35.3, lng: -80.9 }

const uberPrice = (over: Partial<any> = {}) => ({
  product_id: 'uberx',
  display_name: 'UberX',
  estimate: '$12-16',
  low_estimate: 12,
  high_estimate: 16,
  currency_code: 'USD',
  duration: 900,
  distance: 5,
  ...over,
})

const lyftCost = (over: Partial<any> = {}) => ({
  ride_type: 'lyft',
  display_name: 'Lyft',
  estimated_cost_cents_min: 1200,
  estimated_cost_cents_max: 1600,
  currency: 'USD',
  estimated_duration_seconds: 900,
  estimated_distance_miles: 5,
  ...over,
})

describe('adaptUberEstimates', () => {
  test('maps a price estimate to the unified shape', () => {
    const [product] = adaptUberEstimates(
      [uberPrice()],
      [{ product_id: 'uberx', display_name: 'UberX', estimate: 240 }],
      origin,
      destination,
    )

    expect(product).toMatchObject({
      productId: 'uberx',
      displayName: 'UberX',
      estimatedPickupTime: 240,
      estimatedDuration: 900,
    })
  })

  test('reports prices in currency units', () => {
    const [product] = adaptUberEstimates([uberPrice()], [], origin, destination)

    expect(product.estimatedPrice.low).toEqual({ value: 12, currency: 'USD' })
    expect(product.estimatedPrice.high).toEqual({ value: 16, currency: 'USD' })
  })

  test('converts miles to metres', () => {
    const [product] = adaptUberEstimates(
      [uberPrice({ distance: 5 })],
      [],
      origin,
      destination,
    )

    expect(product.estimatedDistance).toBe(8047)
  })

  test('joins the ETA by product id', () => {
    const [x, black] = adaptUberEstimates(
      [uberPrice(), uberPrice({ product_id: 'uberblack', display_name: 'Black' })],
      [
        { product_id: 'uberblack', display_name: 'Black', estimate: 600 },
        { product_id: 'uberx', display_name: 'UberX', estimate: 120 },
      ],
      origin,
      destination,
    )

    expect(x.estimatedPickupTime).toBe(120)
    expect(black.estimatedPickupTime).toBe(600)
  })

  test('falls back to a 5-minute ETA when no time estimate matches', () => {
    const [product] = adaptUberEstimates([uberPrice()], [], origin, destination)

    expect(product.estimatedPickupTime).toBe(300)
  })

  test('passes the surge multiplier through', () => {
    const [product] = adaptUberEstimates(
      [uberPrice({ surge_multiplier: 1.8 })],
      [],
      origin,
      destination,
    )

    expect(product.estimatedPrice.surgeMultiplier).toBe(1.8)
  })

  test('drops a product with no price bounds', () => {
    const products = adaptUberEstimates(
      [uberPrice({ low_estimate: null }), uberPrice({ product_id: 'ok' })],
      [],
      origin,
      destination,
    )

    expect(products).toHaveLength(1)
    expect(products[0].productId).toBe('ok')
  })

  test('builds a deep link carrying both endpoints and the product', () => {
    const [product] = adaptUberEstimates([uberPrice()], [], origin, destination)

    const url = new URL(product.bookingUrl)
    expect(url.origin + url.pathname).toBe('https://m.uber.com/ul/')
    expect(url.searchParams.get('pickup[latitude]')).toBe('35.2')
    expect(url.searchParams.get('dropoff[longitude]')).toBe('-80.9')
    expect(url.searchParams.get('product_id')).toBe('uberx')
  })

  test('reports 6 seats for XL and SUV tiers', () => {
    const [xl] = adaptUberEstimates(
      [uberPrice({ display_name: 'UberXL' })],
      [],
      origin,
      destination,
    )
    const [suv] = adaptUberEstimates(
      [uberPrice({ display_name: 'Black SUV' })],
      [],
      origin,
      destination,
    )

    expect(xl.capacity).toBe(6)
    expect(suv.capacity).toBe(6)
  })

  test('reports 4 seats for a standard tier', () => {
    const [product] = adaptUberEstimates([uberPrice()], [], origin, destination)

    expect(product.capacity).toBe(4)
  })

  test('returns an empty list for no prices', () => {
    expect(adaptUberEstimates([], [], origin, destination)).toEqual([])
  })
})

describe('adaptLyftEstimates', () => {
  test('converts CENTS to currency units', () => {
    // The headline risk: forgetting this shows fares 100× too high.
    const [product] = adaptLyftEstimates([lyftCost()], [], origin, destination)

    expect(product.estimatedPrice.low).toEqual({ value: 12, currency: 'USD' })
    expect(product.estimatedPrice.high).toEqual({ value: 16, currency: 'USD' })
  })

  test('converts miles to metres', () => {
    const [product] = adaptLyftEstimates([lyftCost()], [], origin, destination)

    expect(product.estimatedDistance).toBe(8047)
  })

  test('joins the ETA by ride type', () => {
    const [product] = adaptLyftEstimates(
      [lyftCost()],
      [{ ride_type: 'lyft', display_name: 'Lyft', eta_seconds: 180 }],
      origin,
      destination,
    )

    expect(product.estimatedPickupTime).toBe(180)
  })

  test('falls back to a 5-minute ETA when no match exists', () => {
    const [product] = adaptLyftEstimates([lyftCost()], [], origin, destination)

    expect(product.estimatedPickupTime).toBe(300)
  })

  test('turns a primetime percentage into a surge multiplier', () => {
    const [product] = adaptLyftEstimates(
      [lyftCost({ primetime_percentage: '25%' })],
      [],
      origin,
      destination,
    )

    expect(product.estimatedPrice.surgeMultiplier).toBe(1.25)
  })

  test('omits the multiplier when there is no primetime', () => {
    const [product] = adaptLyftEstimates([lyftCost()], [], origin, destination)

    expect(product.estimatedPrice.surgeMultiplier).toBeUndefined()
  })

  test('omits the multiplier for a zero-percent primetime', () => {
    const [product] = adaptLyftEstimates(
      [lyftCost({ primetime_percentage: '0%' })],
      [],
      origin,
      destination,
    )

    expect(product.estimatedPrice.surgeMultiplier).toBeUndefined()
  })

  test('drops a product with no minimum cost', () => {
    const products = adaptLyftEstimates(
      [lyftCost({ estimated_cost_cents_min: null })],
      [],
      origin,
      destination,
    )

    expect(products).toEqual([])
  })

  test('builds a lyft:// deep link with both endpoints', () => {
    const [product] = adaptLyftEstimates([lyftCost()], [], origin, destination)

    expect(product.bookingUrl.startsWith('lyft://ridetype?')).toBe(true)
    expect(product.bookingUrl).toContain('pickup%5Blatitude%5D=35.2')
    expect(product.bookingUrl).toContain('destination%5Blongitude%5D=-80.9')
  })

  test('reports 6 seats for XL and SUV ride types', () => {
    const [xl] = adaptLyftEstimates(
      [lyftCost({ ride_type: 'lyft_xl' })],
      [],
      origin,
      destination,
    )

    expect(xl.capacity).toBe(6)
  })

  test('reports 4 seats for a standard ride type', () => {
    const [product] = adaptLyftEstimates([lyftCost()], [], origin, destination)

    expect(product.capacity).toBe(4)
  })
})
