import { describe, expect, test } from 'vitest'
import { abutments, EMBANK } from './abutments'
import { carvedAt } from '@/lib/map-terrain/carve'
import { metresPerUnit, type Chain, type Point } from './decks'

const y0 = 0.4012
const M = 1 / metresPerUnit(y0)
const line = (...xs: number[]): Point[] => xs.map(x => [0.2789 + x * M, y0])

describe('abutments', () => {
  const points = line(0, 10, 20, 30, 40, 50, 60)
  const chain: Chain = { points, grounded: [true, false], layer: 1, width: 10, kind: 'road', edges: [5, 5] }
  const z = [100, 100.6, 101.2, 102.4, 104, 106, 108]
  const ground = [100, 100, 100, 100, 100, 100, 100]
  const mould = abutments([{ key: 'a', chain, z, groundAt: ground }])

  test('moulds only a grounded end, as far as the deck stands low over the ground', () => {
    expect(mould.size).toBe(2)
    const fill = [...mould.values()].find(f => f.fill)!
    const reach = fill.points.length - 1
    expect(z.slice(0, reach).every((h, i) => h - ground[i] <= EMBANK.over)).toBe(true)
  })

  test('brings the ground to just under the deck top, banking down beside it', () => {
    const fill = [...mould.values()].find(f => f.fill)!
    expect(carvedAt(fill, [0.2789 + 10 * M, y0])!).toBeCloseTo(100.55, 2)
    expect(carvedAt(fill, [0.2789 + 10 * M, y0 + 8 * M])!).toBeLessThan(100.55)
  })
})
