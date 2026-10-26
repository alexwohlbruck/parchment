import { describe, expect, test } from 'vitest'
import { deckMeshOut, metresPerUnit, unmercator, type Point } from '../decks'
import { testSurface } from '../test-surface'
import { routeOverlay } from './route-overlay'

test('clips a long navigation route to the loaded bridge before densifying it', () => {
  const origin: Point = [0.25, 0.4], scale = 1 / metresPerUnit(origin[1])
  const point = (x: number): Point => [origin[0] + x * scale, origin[1]]
  const surface = testSurface([point(0), point(100)], [10, 10])
  const mesh = deckMeshOut()
  routeOverlay(mesh, [{ points: [point(-1_000_000), point(1_000_000)] }], [surface], origin)
  expect(mesh.position.length).toBeGreaterThan(0)
  expect(mesh.position.length).toBeLessThan(2000)
  expect(mesh.position.every(Number.isFinite)).toBe(true)
  const absent = deckMeshOut()
  routeOverlay(absent, [{ points: [point(1000), point(1100)] }], [surface], origin)
  expect(absent.position).toHaveLength(0)
})

test('carries each vertex\'s metres along a measured route, and -1 along an unmeasured one', () => {
  const origin: Point = [0.25, 0.4], scale = 1 / metresPerUnit(origin[1])
  const point = (x: number): Point => [origin[0] + x * scale, origin[1]]
  const surface = testSurface([point(0), point(100)], [10, 10])
  const start = unmercator(point(0))
  const metres = ([lng]: [number, number]) => ((lng - start[0]) / 360) / scale

  const measuredMesh = deckMeshOut()
  routeOverlay(measuredMesh, [{ points: [point(10), point(90)], measure: lngLat => metres(lngLat) }], [surface], origin)
  const along = measuredMesh.color.filter((_, i) => i % 3 === 1)
  expect(Math.min(...along)).toBeCloseTo(10, 0)
  expect(Math.max(...along)).toBeCloseTo(90, 0)

  const plain = deckMeshOut()
  routeOverlay(plain, [{ points: [point(10), point(90)] }], [surface], origin)
  expect(plain.color.filter((_, i) => i % 3 === 1).every(s => s === -1)).toBe(true)
})

describe('which stretches a route rides', () => {
  const origin: Point = [0.25, 0.4], scale = 1 / metresPerUnit(origin[1])
  const at = (x: number, y = 0): Point => [origin[0] + x * scale, origin[1] + y * scale]
  const surface = testSurface([at(0), at(100)], [10, 10])
  const start = unmercator(at(0))
  const measure = ([lng]: [number, number]) => ((lng - start[0]) / 360) / scale

  test('a route crossing under or over a deck is not laid on it', () => {
    const mesh = deckMeshOut()
    const laid = routeOverlay(mesh, [{ points: [at(50, -60), at(50, 60)], measure: () => 0 }], [surface], origin)
    expect(mesh.position).toHaveLength(0)
    expect(laid).toEqual([[]])
  })

  test('a measured route reports the stretch it was laid over', () => {
    const [[span]] = routeOverlay(deckMeshOut(), [{ points: [at(10), at(90)], measure }], [surface], origin)
    expect(span[0]).toBeCloseTo(10, 0)
    expect(span[1]).toBeCloseTo(90, 0)
  })

  test('a route rides the deck only where it may', () => {
    const [spans] = routeOverlay(deckMeshOut(), [{ points: [at(10), at(90)], measure, rides: s => s < 50 }], [surface], origin)
    expect(spans).toHaveLength(1)
    expect(spans[0][1]).toBeLessThanOrEqual(50)
  })

  test('the route is laid beside its line by its offset, to the right of travel', () => {
    const mesh = deckMeshOut()
    routeOverlay(mesh, [{ points: [at(10), at(90)], offset: 2 }], [surface], origin)
    const ys = mesh.position.filter((_, i) => i % 3 === 1)
    expect((ys.reduce((a, b) => a + b, 0) / ys.length) / scale).toBeCloseTo(2, 1)
  })
})
