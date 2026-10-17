import { describe, expect, test } from 'vitest'
import { abutmentMesh, abutments, approachLift, APPROACH_SLAB, EMBANK } from './abutments'
import { carvedAt } from '@/lib/map-terrain/carve'
import { deckMeshOut, metresPerUnit, type Chain, type Point } from './decks'

const y0 = 0.4012
const M = 1 / metresPerUnit(y0)
const line = (...xs: number[]): Point[] => xs.map(x => [0.2789 + x * M, y0])

describe('abutments', () => {
  const points = line(0, 10, 20, 30, 40, 50, 60)
  const chain: Chain = { points, grounded: [true, false], layer: 1, width: 10, kind: 'road', edges: [5, 5] }
  const z = [100, 100.6, 101.2, 102.4, 104, 106, 108]
  const ground = [100, 100, 100, 100, 100, 100, 100]
  const mould = abutments([{ key: 'a', chain, z, groundAt: ground }])

  test('cuts the ground only at a grounded end, as far as the deck stands low over it', () => {
    expect(mould.size).toBe(1)
    const [cut] = [...mould.values()]
    expect(cut.fill).toBe(false)
    expect(z.slice(0, cut.points.length - 1).every((h, i) => h - ground[i] <= EMBANK.over)).toBe(true)
  })

  test('brings the ground down to just under the deck top', () => {
    const [cut] = [...mould.values()]
    expect(carvedAt(cut, [0.2789 + 10 * M, y0])!).toBeCloseTo(100.55, 2)
  })
})

describe('approachLift', () => {
  const s = metresPerUnit(y0)
  const approach = { p: [0.2789, y0] as Point, out: [-1, 0] as Point, half: 5, rise: 1 }

  test('eases from the rise at the end down to nothing, smoothly', () => {
    const at = (m: number) => approachLift([approach], [0.2789 - m * M, y0], s)
    expect(at(0)).toBeCloseTo(1, 6)
    expect(at(APPROACH_SLAB.length / 2)).toBeCloseTo(0.5, 6)
    expect(at(APPROACH_SLAB.length)).toBeCloseTo(0, 6)
    expect(at(1) - at(0)).toBeGreaterThan(-0.01)
  })

  test('does not reach beside the road or back onto the deck', () => {
    expect(approachLift([approach], [0.2789 - 10 * M, y0 + 6 * M], s)).toBe(0)
    expect(approachLift([approach], [0.2789 + 5 * M, y0], s)).toBe(0)
  })
})

describe('abutmentMesh', () => {
  test('stands a wall and two wings where the deck leaves the ground, down into it', () => {
    const points = line(0, 10, 20, 30, 40)
    const chain: Chain = { points, grounded: [true, false], layer: 1, width: 10, kind: 'road', edges: [5, 5] }
    const out = deckMeshOut()
    abutmentMesh(chain, [100, 101, 104, 106, 106], [100, 100, 100, 100, 100], 1.8, points[0], [1, 1, 1], out, metresPerUnit(y0))
    expect(out.position.length / 3).toBe(3 * 6 + 4 * 6)
    const zs = out.position.filter((_, k) => k % 3 === 2).map(v => v * metresPerUnit(y0))
    expect(Math.min(...zs)).toBeCloseTo(98.5, 3)
    expect(Math.max(...zs)).toBeCloseTo(101.8 - 0.8, 3)
  })

  const span = (grounded: [boolean, boolean], z: number[], edges: [number, number]) => {
    const points = line(0, 10, 20, 30, 40)
    const out = deckMeshOut()
    abutmentMesh({ points, grounded, layer: 1, width: 10, kind: 'road', edges }, z, [100, 100, 100, 100, 100], 1.8, points[0], [1, 1, 1], out, metresPerUnit(y0))
    const xs = out.position.filter((_, k) => k % 3 === 0).map(v => v / M)
    const ys = out.position.filter((_, k) => k % 3 === 1).map(v => v / M)
    return { xs, ys }
  }

  test('stands at the deck crossing its clearance, wings back toward the end it stands at', () => {
    const near = span([true, false], [100, 101, 104, 106, 106], [5, 5])
    expect(Math.max(...near.xs)).toBeCloseTo(10 + 10 * (0.8 / 3) + 0.8, 1)
    expect(Math.min(...near.xs)).toBeLessThan(10 + 10 * (0.8 / 3) - 1)
    const far = span([false, true], [106, 106, 104, 101, 100], [5, 5])
    expect(Math.min(...far.xs)).toBeCloseTo(30 - 10 * (0.8 / 3) - 0.8, 1)
    expect(Math.max(...far.xs)).toBeGreaterThan(30 - 10 * (0.8 / 3) + 1)
  })

  test('spans the deck at its own width on each side', () => {
    const { ys } = span([true, false], [100, 101, 104, 106, 106], [3, 7])
    const wall = ys.slice(0, 18)
    expect(Math.max(...wall)).toBeCloseTo(3.3, 1)
    expect(Math.min(...wall)).toBeCloseTo(-7.3, 1)
  })
})
