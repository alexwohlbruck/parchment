import { describe, expect, test } from 'vitest'
import { along, boundsOf, deckMeshOut, inside, kerbBands, kerbsOf, metresPerUnit, type Chain, type Point } from './decks'
import { layPaint } from './paint'

const y0 = 0.4012
const M = 1 / metresPerUnit(y0)
const at = (x: number, y = 0): Point => [0.2789 + x * M, y0 + y * M]
const line = (...xs: number[]): Point[] => xs.map(x => at(x))
const deck = (points: Point[], edges: [number, number] = [6, 6]): Chain =>
  ({ points, grounded: [true, true], layer: 1, width: 12, kind: 'road', edges })
const kerbLine = (y: number, from = 0, to = 60) => Array.from({ length: (to - from) / 3 + 1 }, (_, k) => at(from + k * 3, y))
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

describe('kerbsOf', () => {
  const c = deck(line(0, 10, 20, 30, 40, 50, 60))

  test('reads the kerb on each side, and the edge where a side has none', () => {
    const [left, right] = kerbsOf(c, [...kerbLine(4), ...kerbLine(-4)])
    left.forEach(v => expect(v).toBeCloseTo(4, 1))
    right.forEach(v => expect(v).toBeCloseTo(4, 1))
    const [, bare] = kerbsOf(c, kerbLine(4))
    bare.forEach(v => expect(v).toBe(6))
  })

  test('ignores points beyond the deck, and never reads past its edge', () => {
    const [left] = kerbsOf(c, kerbLine(9))
    left.forEach(v => expect(v).toBe(6))
    const [narrow] = kerbsOf({ ...c, sides: [c.points.map(() => 3), c.points.map(() => 6)] }, kerbLine(4))
    narrow.forEach(v => expect(v).toBe(3))
  })

  test('carries a reading a short way along, and always to the ends', () => {
    const fine = deck(line(...Array.from({ length: 13 }, (_, k) => k * 5)))
    const [left] = kerbsOf(fine, kerbLine(4, 30, 30))
    expect(left[6]).toBeCloseTo(4, 1)
    expect(left[5]).toBeCloseTo(4, 1)
    expect(left[4]).toBe(6)
    expect(left[0]).toBeCloseTo(4, 1)
    expect(left[12]).toBeCloseTo(4, 1)
  })
})

describe('kerbBands', () => {
  const c = deck(line(0, 10, 20))
  const z = [100, 100, 100]
  const draw = (kerbs: [number[], number[]]) => {
    const out = deckMeshOut()
    kerbBands(c, z, z, kerbs, { walkway: [1, 1, 1], low: [0.9, 0.9, 0.9] }, c.points[0], out)
    return out
  }

  test('lays walkway from each kerb to the deck edge, just over it', () => {
    const out = draw([[4, 4, 4], [4, 4, 4]])
    expect(out.position.length / 3).toBe(2 * 2 * 6)
    const ys = out.position.filter((_, k) => k % 3 === 1).map(y => Math.abs(y / M))
    expect(Math.max(...ys)).toBeCloseTo(6, 1)
    expect(Math.min(...ys)).toBeCloseTo(4, 1)
    out.position.filter((_, k) => k % 3 === 2).forEach(h => expect(h * metresPerUnit(y0)).toBeCloseTo(100.005, 3))
  })

  test('draws nothing for a kerb at the edge, or room wider than a sidewalk', () => {
    expect(draw([[6, 6, 6], [6, 6, 6]]).position).toHaveLength(0)
    expect(draw([[0.5, 0.5, 0.5], [6, 6, 6]]).position).toHaveLength(0)
  })
})

describe('a carriageway past a deck\'s skewed end', () => {
  const points = line(0, 20, 40)
  const surface = { points, z: [100, 100, 100], d: along(points), width: 13, bounds: boundsOf(points, 7), ground: [100, 100, 100] }
  const area = [[at(-15, -5), at(40, -5), at(40, 5), at(-15, 5)]]
  const paint = [{ props: { kind: 'surface', pattern: 'fill', color: 'asphalt' }, runs: [], areas: [area] }]
  const near = [boundsOf([at(-20, 0), at(0, 0)], 8)]

  test('is laid on the ground beside the deck, never on or under it, and only near its end', () => {
    const mesh = deckMeshOut()
    layPaint(mesh, paint, [surface], colors, points[0], { ground: { at: () => 99, near, low: [0.9, 0.9, 0.9] }, offDeck: true })
    expect(mesh.position.length).toBeGreaterThan(0)
    for (let k = 0; k < mesh.position.length; k += 3) {
      const x = mesh.position[k] / M
      expect(x).toBeLessThan(0.01)
      expect(x).toBeGreaterThan(-15.01)
      expect(mesh.position[k + 2] * metresPerUnit(y0)).toBeLessThan(99.1)
    }
  })

  test('is not laid where the ground is not known', () => {
    const mesh = deckMeshOut()
    layPaint(mesh, paint, [surface], colors, points[0], { ground: { at: () => null, near, low: [0.9, 0.9, 0.9] }, offDeck: true })
    expect(mesh.position).toHaveLength(0)
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
