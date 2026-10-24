import { expect, test } from 'vitest'
import { deckMeshOut, metresPerUnit, type Point } from '../decks'
import { testSurface } from '../test-surface'
import { routeOverlay } from './route-overlay'

test('clips a long navigation route to the loaded bridge before densifying it', () => {
  const origin: Point = [0.25, 0.4], scale = 1 / metresPerUnit(origin[1])
  const point = (x: number): Point => [origin[0] + x * scale, origin[1]]
  const surface = testSurface([point(0), point(100)], [10, 10])
  const mesh = deckMeshOut()
  routeOverlay(mesh, [[point(-1_000_000), point(1_000_000)]], [surface], origin)
  expect(mesh.position.length).toBeGreaterThan(0)
  expect(mesh.position.length).toBeLessThan(2000)
  expect(mesh.position.every(Number.isFinite)).toBe(true)
  const absent = deckMeshOut()
  routeOverlay(absent, [[point(1000), point(1100)]], [surface], origin)
  expect(absent.position).toHaveLength(0)
})
