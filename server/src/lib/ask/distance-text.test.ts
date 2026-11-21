import { test, expect } from 'bun:test'
import { climbText, distanceText } from './distance-text'

test('distanceText speaks the user\'s units, short distances in feet or metres', () => {
  expect(distanceText(34, 'imperial')).toBe('110 ft')
  expect(distanceText(1931, 'imperial')).toBe('1.2 mi')
  expect(distanceText(34, 'metric')).toBe('30 m')
  expect(distanceText(3400, 'metric')).toBe('3.4 km')
})

test('climbText speaks the user\'s units', () => {
  expect(climbText(40, 'imperial')).toBe('131 ft')
  expect(climbText(40.4, 'metric')).toBe('40 m')
})
