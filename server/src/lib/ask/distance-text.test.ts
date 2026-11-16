import { test, expect } from 'bun:test'
import { distanceText } from './distance-text'

test('distanceText speaks the user\'s units, short distances in feet or metres', () => {
  expect(distanceText(34, 'imperial')).toBe('110 ft')
  expect(distanceText(1931, 'imperial')).toBe('1.2 mi')
  expect(distanceText(34, 'metric')).toBe('30 m')
  expect(distanceText(3400, 'metric')).toBe('3.4 km')
})
