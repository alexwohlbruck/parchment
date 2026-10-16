import { describe, expect, test } from 'vitest'
import { along, boundsOf, deckMeshOut, grownRing, inside, metresPerUnit, type Point } from './decks'
import { layPaint } from './paint'
import { testSurface } from './test-surface'

const y0 = 0.4012
const M = 1 / metresPerUnit(y0)
const at = (x: number, y = 0): Point => [0.2789 + x * M, y0 + y * M]
const line = (...xs: number[]): Point[] => xs.map(x => at(x))
const colors = { white: [1, 1, 1], yellow: [1, 1, 0], green: [0, 1, 0], red: [1, 0, 0], asphalt: [0.5, 0.5, 0.5] }

describe('inside', () => {
  test('even-odd over a polygon with a hole', () => {
    const outer = [at(0, 0), at(10, 0), at(10, 10), at(0, 10)]
    const hole = [at(4, 4), at(6, 4), at(6, 6), at(4, 6)]
    expect(inside(at(2, 2), [outer, hole])).toBe(true)
    expect(inside(at(5, 5), [outer, hole])).toBe(false)
    expect(inside(at(12, 5), [outer])).toBe(false)
  })
})

describe('a carriageway past a deck\'s skewed end', () => {
  const points = line(0, 20, 40)
  const surface = testSurface(points, [100, 100, 100], [100, 100, 100])
  const area = [[at(-15, -5), at(40, -5), at(40, 5), at(-15, 5)]]
  const paint = [{ props: { kind: 'surface', pattern: 'fill', color: 'asphalt' }, runs: [], areas: [area] }]
  const near = [boundsOf([at(-20, 0), at(0, 0)], 8)]

  test('is laid on the deck over it and on the ground beside its end, never under it', () => {
    const mesh = deckMeshOut()
    layPaint(mesh, paint, [surface], colors, points[0], { ground: { at: () => 99, near, low: [0.9, 0.9, 0.9] } })
    let [onDeck, beside] = [0, 0]
    for (let k = 0; k < mesh.position.length; k += 9) {
      const x = (mesh.position[k] + mesh.position[k + 3] + mesh.position[k + 6]) / 3 / M
      const z = (mesh.position[k + 2] + mesh.position[k + 5] + mesh.position[k + 8]) / 3 * metresPerUnit(y0)
      expect(x).toBeGreaterThan(-15.01)
      if (x > 0.01) {
        onDeck++
        expect(z).toBeGreaterThan(100)
      } else if (x < -0.01) {
        beside++
        expect(z).toBeLessThan(99.1)
      }
    }
    expect(onDeck).toBeGreaterThan(0)
    expect(beside).toBeGreaterThan(0)
  })

  test('is not laid beside the deck where the ground is not known', () => {
    const mesh = deckMeshOut()
    layPaint(mesh, paint, [surface], colors, points[0], { ground: { at: () => null, near, low: [0.9, 0.9, 0.9] } })
    expect(mesh.position.length).toBeGreaterThan(0)
    // Only what lies on the deck, which runs a quarter metre past its drawn end.
    for (let k = 0; k < mesh.position.length; k += 3) expect(mesh.position[k] / M).toBeGreaterThan(-0.26)
  })
})

describe('a painted area with no corner on a deck', () => {
  test('is cut to decks at its own level and never onto one far below', () => {
    const upper = line(0, 30)
    const lower = line(0, 30).map(([x, y]) => [x, y + 20 * M] as Point)
    const decks = [testSurface(upper, [110, 110], [100, 100], 4), testSurface(lower, [100, 100], [92, 92], 4)]
    // A long thin hatch whose corners lie past both decks' sides, at the upper deck's level by its own corner on it.
    const ring = [at(10, 0), at(12, 0), at(12, 30), at(10, 30)]
    const mesh = deckMeshOut()
    layPaint(mesh, [{ props: { kind: 'hatch', pattern: 'fill', color: 'white' }, runs: [], areas: [[ring]] }], decks, colors, upper[0])
    for (let k = 2; k < mesh.position.length; k += 3) expect(mesh.position[k] * metresPerUnit(y0)).toBeGreaterThan(105)
  })
})

describe('grownRing', () => {
  test('grows a ring outward whichever way it winds', () => {
    const square = [at(0, 0), at(10, 0), at(10, 10), at(0, 10)]
    for (const ring of [square, [...square].reverse()]) {
      const grown = grownRing(ring, 1)
      const xs = grown.map(p => (p[0] - at(0, 0)[0]) / M)
      expect(Math.min(...xs)).toBeCloseTo(-1, 3)
      expect(Math.max(...xs)).toBeCloseTo(11, 3)
    }
  })
})

describe('an area on a deck\'s drawn top', () => {
  test('covers exactly its part of the deck, at the height of the top drawn there', async () => {
    const { deckMesh } = await import('./decks')
    const points = line(0, 10, 20, 30)
    const chain = { points, grounded: [true, true] as [boolean, boolean], layer: 1, width: 12, kind: 'road' as const, edges: [6, 6] as [number, number] }
    const z = [100, 101, 102, 101]
    const tops: any[] = []
    deckMesh(chain, z, [99, 99, 99, 99], points[0], { surface: [0, 0, 0], concrete: [1, 1, 1], parapet: [1, 1, 1] }, deckMeshOut(), undefined, undefined, tops)
    const surface = { points, z, d: along(points), width: 13, bounds: boundsOf(points, 7), tops, edges: [points.map(([x, y]) => [x, y + 6 * M] as Point), points.map(([x, y]) => [x, y - 6 * M] as Point)] as [Point[], Point[]] }
    const ring = [at(5, -3), at(25, -3), at(25, 3), at(5, 3)]
    const mesh = deckMeshOut()
    layPaint(mesh, [{ props: { kind: 'surface', pattern: 'fill', color: 'asphalt' }, runs: [], areas: [[ring]] }], [surface], colors, points[0])
    const p = mesh.position
    let area = 0
    for (let k = 0; k < p.length; k += 9) area += Math.abs((p[k + 3] - p[k]) * (p[k + 7] - p[k + 1]) - (p[k + 6] - p[k]) * (p[k + 4] - p[k + 1])) / 2 / (M * M)
    expect(area).toBeCloseTo(120, 0)
    for (let k = 0; k < p.length; k += 3) {
      const x = p[k] / M
      const expected = x <= 10 ? 100 + x / 10 : 101 + (Math.min(x, 20) - 10) / 10
      if (x < 20) expect(p[k + 2] * metresPerUnit(y0)).toBeCloseTo(expected + 0.01, 2)
    }
  })
})

describe('subtractConvex', () => {
  test('leaves exactly the area outside the hole, and ignores an edge of no length', async () => {
    const { subtractConvex } = await import('./decks')
    const tri = [at(0, 0), at(10, 0), at(0, 10)]
    const hole = [at(0, 0), at(5, 0), at(5, 0), at(5, 5), at(0, 5)]
    const area = (p: Point[]) => Math.abs(p.reduce((a, q, i) => a + q[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * q[1], 0)) / 2 / (M * M)
    expect(subtractConvex(tri, hole).reduce((a, p) => a + area(p), 0)).toBeCloseTo(50 - 25, 1)
  })
})
