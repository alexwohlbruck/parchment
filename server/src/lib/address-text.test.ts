import { describe, expect, test } from 'bun:test'
import { normalizeStreetName } from './address-text'

describe('normalizeStreetName', () => {
  test.each([
    ['W 18th St', 'West 18th Street'],
    ['Cooper Sq', 'Cooper Square'],
    ['Reichenberger Str.', 'Reichenberger Straße'],
    ['Torstr.', 'Torstraße'],
    ['Bd Voltaire', 'Boulevard Voltaire'],
  ])('%s reads as %s', (short, long) => {
    expect(normalizeStreetName(short)).toBe(normalizeStreetName(long))
  })
})
