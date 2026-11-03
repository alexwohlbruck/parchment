import { describe, expect, test } from 'vitest'
import { hsl } from './palette'

describe('hsl', () => {
  test('reads a basemap token as rgb', () => {
    expect(hsl('hsl(0, 0%, 100%)')).toEqual([1, 1, 1])
    hsl('hsl(120, 100%, 25%)').forEach((v, i) => expect(v).toBeCloseTo([0, 0.5, 0][i], 6))
  })
})
