/**
 * Tests for the viewport bounds validator used by the realtime WS handler.
 *
 * The function under test is the one the handler actually calls. It used to be
 * inline in the controller with a copy of the logic reproduced here, which meant
 * these tests passed regardless of what the handler did.
 */

import { describe, test, expect } from 'bun:test'
import { validateBounds } from './bounds'

describe('bounds validation', () => {
  test('accepts valid NYC bounds', () => {
    const b = { north: 40.9, south: 40.5, east: -73.7, west: -74.3 }
    expect(validateBounds(b)).toEqual(b)
  })

  test('rejects NaN values', () => {
    expect(validateBounds({ north: NaN, south: 40.5, east: -73.7, west: -74.3 })).toBeNull()
    expect(validateBounds({ north: 40.9, south: NaN, east: -73.7, west: -74.3 })).toBeNull()
    expect(validateBounds({ north: 40.9, south: 40.5, east: NaN, west: -74.3 })).toBeNull()
    expect(validateBounds({ north: 40.9, south: 40.5, east: -73.7, west: NaN })).toBeNull()
  })

  test('rejects Infinity', () => {
    expect(validateBounds({ north: Infinity, south: -Infinity, east: 180, west: -180 })).toBeNull()
  })

  test('rejects north < south', () => {
    expect(validateBounds({ north: 40.0, south: 41.0, east: -73.7, west: -74.3 })).toBeNull()
  })

  test('rejects latitude out of range', () => {
    expect(validateBounds({ north: 91, south: 40.5, east: -73.7, west: -74.3 })).toBeNull()
    expect(validateBounds({ north: 40.9, south: -91, east: -73.7, west: -74.3 })).toBeNull()
  })

  test('rejects longitude out of range', () => {
    expect(validateBounds({ north: 40.9, south: 40.5, east: 181, west: -74.3 })).toBeNull()
    expect(validateBounds({ north: 40.9, south: 40.5, east: -73.7, west: -181 })).toBeNull()
  })

  test('rejects null/undefined/string', () => {
    expect(validateBounds(null)).toBeNull()
    expect(validateBounds(undefined)).toBeNull()
    expect(validateBounds('not bounds')).toBeNull()
  })

  test('rejects missing fields', () => {
    expect(validateBounds({ north: 40.9 })).toBeNull()
    expect(validateBounds({})).toBeNull()
  })

  test('accepts edge case: equator crossing', () => {
    const b = { north: 10, south: -10, east: 10, west: -10 }
    expect(validateBounds(b)).toEqual(b)
  })

  test('accepts edge case: antimeridian safe bounds', () => {
    const b = { north: 40, south: 30, east: 179, west: -179 }
    expect(validateBounds(b)).toEqual(b)
  })

  test('accepts single point (north === south)', () => {
    const b = { north: 40.5, south: 40.5, east: -73.7, west: -74.3 }
    expect(validateBounds(b)).toEqual(b)
  })
})
