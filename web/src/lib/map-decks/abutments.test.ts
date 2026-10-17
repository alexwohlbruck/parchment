import { describe, expect, test } from 'vitest'
import { abutmentMesh, abutments, approachLift, approachMesh, APPROACH_SLAB, CUT } from './abutments'
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
    expect(z.slice(0, cut.points.length - 1).every((h, i) => h - ground[i] <= CUT.over)).toBe(true)
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
    abutmentMesh(chain, [100, 101, 104, 106, 106], [100, 100, 100, 100, 100], 1.8, { origin: points[0], metresPerUnit: metresPerUnit(y0), color: [1, 1, 1], out })
    expect(out.position.length / 3).toBe(3 * 5 * 6)
    const zs = out.position.filter((_, k) => k % 3 === 2).map(v => v * metresPerUnit(y0))
    expect(Math.min(...zs)).toBeCloseTo(98.5, 3)
    expect(Math.max(...zs)).toBeCloseTo(101.8 - 0.8, 3)
  })

  const span = (grounded: [boolean, boolean], z: number[], edges: [number, number]) => {
    const points = line(0, 10, 20, 30, 40)
    const out = deckMeshOut()
    abutmentMesh({ points, grounded, layer: 1, width: 10, kind: 'road', edges }, z, [100, 100, 100, 100, 100], 1.8, { origin: points[0], metresPerUnit: metresPerUnit(y0), color: [1, 1, 1], out })
    const xs = out.position.filter((_, k) => k % 3 === 0).map(v => v / M)
    const ys = out.position.filter((_, k) => k % 3 === 1).map(v => v / M)
    return { xs, ys, out }
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
    const wall = ys.slice(0, 30)
    expect(Math.max(...wall)).toBeCloseTo(3.3, 1)
    expect(Math.min(...wall)).toBeCloseTo(-7.3, 1)
  })

  test('faces every wall outward, at either end', () => {
    for (const [grounded, z] of [[[true, false], [100, 101, 104, 106, 106]], [[false, true], [106, 106, 104, 101, 100]]] as const) {
      const { out } = span([...grounded], [...z], [3, 7])
      const P = out.position, N = out.normal
      for (let box = 0; box < P.length; box += 90) {
        const centre = [0, 1, 2].map(c => { let t = 0; for (let k = box + c; k < box + 90; k += 3) t += P[k]; return t / 30 })
        for (let v = box; v < box + 90; v += 9) {
          const mid = [0, 1, 2].map(c => (P[v + c] + P[v + 3 + c] + P[v + 6 + c]) / 3 - centre[c])
          expect(mid[0] * N[v] + mid[1] * N[v + 1] + mid[2] * N[v + 2]).toBeGreaterThan(0)
        }
      }
    }
  })
})

describe('approachMesh', () => {
  test('raises a slab from the deck end down to the ground, walled each side', () => {
    const out = deckMeshOut()
    const s = metresPerUnit(y0)
    approachMesh([{ p: [0.2789, y0], out: [-1, 0], half: 5, rise: 2 }], () => 100, [1, 1, 1], [0.5, 0.5, 0.5], { origin: [0.2789, y0], metresPerUnit: s, color: [0.5, 0.5, 0.5], out })
    const zs = out.position.filter((_, k) => k % 3 === 2).map(v => v * s)
    expect(Math.max(...zs)).toBeCloseTo(102, 3)
    expect(Math.min(...zs)).toBeCloseTo(99, 3)
    const xs = out.position.filter((_, k) => k % 3 === 0).map(v => v / M)
    expect(Math.min(...xs)).toBeCloseTo(-APPROACH_SLAB.length, 3)
    expect(Math.max(...xs)).toBeCloseTo(0, 3)
  })
})
