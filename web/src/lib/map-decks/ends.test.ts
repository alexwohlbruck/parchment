import { describe, expect, test } from 'vitest'
import { along, boundsOf, deckMeshOut, inside, metresPerUnit, type Point } from './decks'
import { layPaint } from './paint'

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
  const surface = { points, z: [100, 100, 100], d: along(points), width: 13, bounds: boundsOf(points, 7), ground: [100, 100, 100],
    edges: [points.map(([x, y]) => [x, y + 6 * M] as Point), points.map(([x, y]) => [x, y - 6 * M] as Point)] as [Point[], Point[]] }
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
    for (let k = 0; k < mesh.position.length; k += 3) expect(mesh.position[k] / M).toBeGreaterThan(-0.01)
  })
})

describe('a painted area with no corner on a deck', () => {
  test('is cut to decks at its own level and never onto one far below', () => {
    const upper = line(0, 30)
    const lower = line(0, 30).map(([x, y]) => [x, y + 20 * M] as Point)
    const decks = [
      { points: upper, z: [110, 110], d: along(upper), width: 9, bounds: boundsOf(upper, 5) },
      { points: lower, z: [100, 100], d: along(lower), width: 9, bounds: boundsOf(lower, 5), edges: [lower.map(([x, y]) => [x, y + 4 * M] as Point), lower.map(([x, y]) => [x, y - 4 * M] as Point)] as [Point[], Point[]] },
    ]
    // A long thin hatch whose corners lie past both decks' sides, at the upper deck's level by its own corner on it.
    const ring = [at(10, 0), at(12, 0), at(12, 30), at(10, 30)]
    const mesh = deckMeshOut()
    layPaint(mesh, [{ props: { kind: 'hatch', pattern: 'fill', color: 'white' }, runs: [], areas: [[ring]] }], decks, colors, upper[0])
    for (let k = 2; k < mesh.position.length; k += 3) expect(mesh.position[k] * metresPerUnit(y0)).toBeGreaterThan(105)
  })
})
