import { describe, expect, test } from 'vitest'
import { along, boundsOf, deckMeshOut, metresPerUnit, type Point } from './decks'
import { layPaint, layWays } from './paint'

const M = 1 / 32780000
const y0 = 0.4012
const line = (...xs: number[]): Point[] => xs.map(x => [0.2789 + x * M, y0])

describe('layWays', () => {
  const points = line(0, 50, 100)
  const deck = { points, z: [100, 106, 100], d: along(points), width: 15, bounds: boundsOf(points, 8), bias: [1.5, 0, 1.5], low: [0.9, 0.9, 0.9] }
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
  const deck = { points, z: [100, 108, 100.2], d: along(points), width: 15, bounds: boundsOf(points, 8), ground: [100, 100, 100] }
  const colors = { white: [1, 1, 1], yellow: [1, 1, 0], green: [0, 1, 0], red: [1, 0, 0] }

  test('is laid where the deck lies on the ground, never where it stands over a road', () => {
    const mesh = deckMeshOut()
    layPaint(mesh, [{ props: { kind: 'centre', pattern: 'solid', color: 'yellow' }, runs: [line(0, 100)], areas: [] }], [deck], colors, points[0], { atGrade: true })
    const xs = mesh.position.filter((_, k) => k % 3 === 0).map(x => x / M)
    expect(xs.length).toBeGreaterThan(0)
    expect(xs.some(x => x > 20 && x < 80)).toBe(false)
  })
})
