import { expect, test } from 'vitest'
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
