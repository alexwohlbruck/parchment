import { describe, expect, test } from 'vitest'
import { closedAreas } from './closing'
import { boundsOf, deckMeshOut, metresPerUnit, type Point } from './decks'
import { layPaint } from './paint'
import { testSurface } from './test-surface'

const y0 = 0.4012
const M = 1 / metresPerUnit(y0)
const at = (x: number, y = 0): Point => [0.2789 + x * M, y0 + y * M]
const rect = (w: number, s: number, e: number, n: number) => [[at(w, s), at(e, s), at(e, n), at(w, n)]]
const box = boundsOf([at(-20, -20), at(40, 20)])

describe('closedAreas', () => {
  test('closes a gap under a metre between pieces into one area, and keeps wider ones apart', () => {
    expect(closedAreas([rect(0, -5, 10, 5), rect(10.8, -5, 20, 5)], [], [box])).toHaveLength(1)
    expect(closedAreas([rect(0, -5, 10, 5), rect(13, -5, 20, 5)], [], [box])).toHaveLength(2)
  })

  test('drops a sliver and leaves out the bridge\'s own carriageway', () => {
    expect(closedAreas([rect(0, -5, 10, 5), rect(0, 8, 20, 8.3)], [], [box])).toHaveLength(1)
    const [left] = closedAreas([rect(0, -5, 20, 5)], [rect(10, -6, 30, 6)], [box])
    expect(Math.max(...left[0].map(q => (q[0] - at(0)[0]) / M))).toBeLessThan(10.01)
  })

  test('is laid on a deck\'s at-grade end', () => {
    const points = [at(0), at(10), at(20), at(30)]
    const surface = testSurface(points, [100, 100, 100, 100], [99.5, 99.5, 99.5, 99.5])
    const areas = closedAreas([rect(-10, -3, 7, 3)], [], [box])
    const mesh = deckMeshOut()
    layPaint(mesh, [{ props: { kind: 'surface', pattern: 'fill', color: 'asphalt' }, runs: [], areas }], [surface], { white: [1, 1, 1], yellow: [1, 1, 0], green: [0, 1, 0], red: [1, 0, 0], asphalt: [0.5, 0.5, 0.5] }, points[0], { atGrade: true })
    expect(mesh.position.length).toBeGreaterThan(0)
  })
})
