import { describe, expect, test } from 'bun:test'
import { isAreaPlace } from './place-tags'

describe('isAreaPlace', () => {
  test('boroughs, neighbourhoods and cities are areas', () => {
    expect(isAreaPlace({ tags: { boundary: 'administrative', admin_level: '6' }, amenities: {} })).toBe(true)
    expect(isAreaPlace({ tags: { place: 'neighbourhood' }, amenities: {} })).toBe(true)
  })

  test('a business is not', () => {
    expect(isAreaPlace({ tags: { amenity: 'fast_food', cuisine: 'pizza' }, amenities: {} })).toBe(false)
  })
})
