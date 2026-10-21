import { describe, expect, test, vi } from 'vitest'
import { along, boundsOf, deckMeshOut, metresPerUnit, type Point } from './decks'
import { layPaint, layWays } from './paint'
import { testSurface } from './test-surface'

const M = 1 / 32780000
const y0 = 0.4012
const line = (...xs: number[]): Point[] => xs.map(x => [0.2789 + x * M, y0])

describe('layWays', () => {
  const points = line(0, 50, 100)
  const deck = testSurface(points, [100, 106, 100], undefined, 7, { bias: [1.5, 0, 1.5], low: [0.9, 0.9, 0.9] })
  const colors = { walkway: [0.95, 0.94, 0.9], rail: [0.5, 0.5, 0.5] }

  test('a sidewalk on a deck is drawn at its height, fading to the deck below street zoom', () => {
    const mesh = deckMeshOut()
    layWays(mesh, [{ kind: 'path', points: line(0, 100) }], [deck], colors, points[0])
    const heights = mesh.position.filter((_, k) => k % 3 === 2).map(z => z * metresPerUnit(y0))
    expect(Math.max(...heights)).toBeCloseTo(106.01, 1)
    expect(mesh.color.slice(0, 3)).toEqual(colors.walkway)
    expect(mesh.low.slice(0, 3)).toEqual(deck.low)
    expect(mesh.bias[0]).toBeCloseTo(1.5, 1)
  })

  test('a track is two rails, and nothing is laid off the deck', () => {
    const rails = deckMeshOut()
    layWays(rails, [{ kind: 'rail', points: line(0, 100) }], [deck], colors, points[0])
    const off = deckMeshOut()
    layWays(off, [{ kind: 'rail', points: line(200, 300) }], [deck], colors, points[0])
    const ys = new Set(rails.position.filter((_, k) => k % 3 === 1).map(y => Math.round(y / M * 100) / 100))
    expect(ys.size).toBe(4)
    expect(off.position).toHaveLength(0)
  })
})

describe('the road\'s paint over a deck end', () => {
  const points = line(0, 50, 100)
  const deck = testSurface(points, [100, 108, 100.2], [100, 100, 100], 7)
  const colors = { white: [1, 1, 1], yellow: [1, 1, 0], green: [0, 1, 0], red: [1, 0, 0] }

  test('is laid where the deck lies on the ground, never where it stands over a road', () => {
    const mesh = deckMeshOut()
    layPaint(mesh, [{ props: { kind: 'centre', pattern: 'solid', color: 'yellow' }, runs: [line(0, 100)], areas: [] }], [deck], colors, points[0], { atGrade: true })
    const xs = mesh.position.filter((_, k) => k % 3 === 0).map(x => x / M)
    expect(xs.length).toBeGreaterThan(0)
    expect(xs.some(x => x > 20 && x < 80)).toBe(false)
  })
})

describe('painted areas on an arched deck', () => {
  test('never dip under the surface between their corners', () => {
    const points = line(...Array.from({ length: 21 }, (_, k) => k * 6))
    const z = points.map((_, k) => 100 + 6 - ((k - 10) ** 2) * 0.06)
    const deck = testSurface(points, z, undefined, 7)
    const lane = [[...line(0, 120), ...line(120, 0).map(([x, y]) => [x, y + 1.5 * M] as Point)].map(p => p)]
    const mesh = deckMeshOut()
    layPaint(mesh, [{ props: { kind: 'bike_lane', pattern: 'fill', color: 'green' }, runs: [], areas: [lane] }], [deck], { white: [1, 1, 1], yellow: [1, 1, 0], green: [0, 1, 0], red: [1, 0, 0] }, points[0])
    const s = metresPerUnit(y0)
    const surface = (x: number) => {
      const metres = (x - 0) / (M * s) * s * M
      const k = Math.min(19, Math.floor(metres / 6))
      const t = metres / 6 - k
      return z[k] + (z[k + 1] - z[k]) * t
    }
    const p = mesh.position
    for (let t = 0; t < p.length; t += 9) {
      const [cx, cz] = [(p[t] + p[t + 3] + p[t + 6]) / 3, (p[t + 2] + p[t + 5] + p[t + 8]) / 3 * s]
      expect(cz).toBeGreaterThan(surface(cx / M) - 0.01)
    }
  })
})

test('paint over a raised deck does not sample ground away from its ends', () => {
  const points = line(0, 50, 100)
  const deck = testSurface(points, [110, 110, 110], [100, 100, 100], 7)
  const ring = [...line(30, 70), ...line(70, 30).map(([x, y]) => [x, y + M] as Point)]
  const paint = [{ props: { kind: 'bike_lane', pattern: 'fill', color: 'green' }, runs: [], areas: [[ring]] }]
  const colors = { white: [1, 1, 1], yellow: [1, 1, 0], green: [0, 1, 0], red: [1, 0, 0] }
  const expected = deckMeshOut()
  layPaint(expected, paint, [deck], colors, points[0])
  const actual = deckMeshOut()
  const at = vi.fn(() => 100)
  layPaint(actual, paint, [deck], colors, points[0], { ground: { at, near: [boundsOf(line(-5, 5))], low: colors.white } })
  expect(actual.position.length).toBeGreaterThan(0)
  expect(actual).toEqual(expected)
  expect(at).not.toHaveBeenCalled()
})
