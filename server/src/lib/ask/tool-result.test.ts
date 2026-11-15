import { test, expect } from 'bun:test'
import { foundCount } from './tool-result'

test('foundCount reads lists, place counts and trips, and nothing else', () => {
  expect(foundCount([1, 2, 3])).toBe(3)
  expect(foundCount({ count: 6, places: [] })).toBe(6)
  expect(foundCount({ trips: [{}, {}] })).toBe(2)
  expect(foundCount({ condition: 'clear sky' })).toBeUndefined()
})
