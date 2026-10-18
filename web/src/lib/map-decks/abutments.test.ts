import { describe, expect, test } from 'vitest'
import { ABUTMENT, abutmentMesh } from './abutments'
import { deckMeshOut, metresPerUnit, SLAB, type Chain, type Point } from './decks'

const y0 = 0.4012
const M = 1 / metresPerUnit(y0)
const line = (...xs: number[]): Point[] => xs.map(x => [0.2789 + x * M, y0])

describe('abutmentMesh', () => {
  const points = line(0, 10, 20, 30, 40)
  const chain = (grounded: [boolean, boolean], edges: [number, number] = [5, 5]): Chain => ({ points, grounded, layer: 1, width: 10, kind: 'road', edges })
  const z = [100, 101, 104, 106, 106]
  const ground = [100, 100, 100, 100, 100]
  const build = (c: Chain, heights = z, clear = () => true) => {
    const out = deckMeshOut()
    abutmentMesh(c, heights, ground, { origin: points[0], color: [1, 1, 1], out }, clear)
    return out
  }
  const xs = (out: ReturnType<typeof deckMeshOut>) => out.position.filter((_, k) => k % 3 === 0).map(v => v / M)

  test('stands where the slab first clears the ground, flush with the deck edges, down into it', () => {
    const out = build(chain([true, false], [3, 7]))
    const wall = out.position.slice(0, 36)
    const crossing = 10 + 10 * ((ABUTMENT.clearance + SLAB - 1) / 3)
    expect(Math.max(...xs(out).slice(0, 12))).toBeCloseTo(crossing, 3)
    const ys = wall.filter((_, k) => k % 3 === 1).map(v => v / M)
    expect(Math.max(...ys)).toBeCloseTo(3, 3)
    expect(Math.min(...ys)).toBeCloseTo(-7, 3)
    const zs = out.position.filter((_, k) => k % 3 === 2).map(v => v * metresPerUnit(y0))
    expect(Math.min(...zs)).toBeCloseTo(100 - ABUTMENT.sink, 3)
  })

  test('faces its wall toward the span at either end', () => {
    for (const [c, heights, away] of [[chain([true, false]), z, 1], [chain([false, true]), [...z].reverse(), -1]] as const) {
      const out = build(c, [...heights])
      expect(Math.sign(out.normal[0])).toBe(away)
    }
  })

  test('stands nowhere its footprint is not clear', () => {
    expect(build(chain([true, false]), z, () => false).position.length).toBe(0)
  })
})
