import { describe, expect, test } from 'vitest'
import { alpha2, countryName } from './country-codes'

describe('country codes', () => {
  test('map alpha-3 to alpha-2', () => {
    expect(alpha2('USA')).toBe('US')
    expect(alpha2('can')).toBe('CA')
    expect(alpha2('XXX')).toBeNull()
  })

  test('name a country in the given locale', () => {
    expect(countryName('MEX', 'en-US')).toBe('Mexico')
    expect(countryName('MEX', 'es-ES')).toBe('México')
    expect(countryName('XXX', 'en-US')).toBeNull()
  })
})
