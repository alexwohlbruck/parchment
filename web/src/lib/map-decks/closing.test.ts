import { describe, expect, test } from 'vitest'
import { closedAreas } from './closing'
import { boundsOf, metresPerUnit, type Point } from './decks'

const y0 = 0.4012
const M = 1 / metresPerUnit(y0)
const at = (x: number, y = 0): Point => [0.2789 + x * M, y0 + y * M]
const rect = (w: number, s: number, e: number, n: number) => [[at(w, s), at(e, s), at(e, n), at(w, n)]]
const area = (rings: Point[][]) => Math.abs(rings[0].reduce((a, q, i, r) => a + q[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * q[1], 0)) / 2 / (M * M)

describe('closedAreas', () => {
  const box = boundsOf([at(-20, -20), at(40, 20)])

  test('closes a gap under a metre between pieces into one area', () => {
    const out = closedAreas([rect(0, -5, 10, 5), rect(10.8, -5, 20, 5)], [box])
    expect(out).toHaveLength(1)
    expect(area(out[0])).toBeGreaterThan(195)
  })

  test('keeps pieces further apart separate, and drops a sliver', () => {
    expect(closedAreas([rect(0, -5, 10, 5), rect(13, -5, 20, 5)], [box])).toHaveLength(2)
    expect(closedAreas([rect(0, -5, 10, 5), rect(0, 8, 20, 8.3)], [box])).toHaveLength(1)
  })
})
