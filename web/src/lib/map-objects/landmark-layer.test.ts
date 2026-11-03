import { expect, it, vi } from 'vitest'
import { eyeOf, LandmarkLayer } from './landmark-layer'
import { LANDMARK_FLAVOR } from './landmarks'
import { planCoverage } from './landmark-coverage'

const polygon = (id: number, offset = 0) => ({
  id,
  geometry: { type: 'Polygon', coordinates: [[[offset, 0], [offset + .00001, 0], [offset, .00001], [offset, 0]]] },
})

it('preserves whole-building containment across chunks and duplicate tile pieces', () => {
  const layer = new LandmarkLayer({
    id: 'landmarks',
    source: 'detail',
    sourceLayer: 'landmarks',
    modelUrl: file => file,
    onReplace: vi.fn(),
    flavor: LANDMARK_FLAVOR.light,
    buildings: [{ source: 'basemap', sourceLayer: 'building' }],
  }) as any
  layer.placements = [{ id: 'tower', model: 'tower', lng: 0, lat: 0, bearing: 0, scale: 1 }]
  layer.models.set('tower', {
    coverage: planCoverage({
      min: [-10, 0, -10], max: [10, 1, 10],
      primitives: [{
        position: new Float32Array([-10, 1, -10, 10, 1, -10, 10, 1, 10, -10, 1, 10]),
        index: new Uint16Array([0, 1, 2, 0, 2, 3]), node: -1,
      }],
    }),
  })
  const features = [...Array.from({ length: 150 }, (_, i) => polygon(i + 1)), polygon(151), polygon(151, 1)]
  layer.map = { querySourceFeatures: () => features }
  const work = layer.findContained()
  let result = work.next()
  let chunks = 0
  while (!result.done) { chunks++; result = work.next() }
  expect(chunks).toBeGreaterThan(3)
  expect(result.value.featureIds).toHaveLength(150)
  expect(result.value.featureIds).toContain(1)
  expect(result.value.featureIds).not.toContain(151)
})

it('finds the camera a perspective matrix projects from', () => {
  // A camera at (3, -4, 5) looking down -z, through a standard perspective.
  const [n, f] = [0.1, 100]
  const projection = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -(f + n) / (f - n), -1, 0, 0, (-2 * f * n) / (f - n), 0]
  const view = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -3, 4, -5, 1]
  const m = new Array(16).fill(0)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) m[c * 4 + r] += projection[k * 4 + r] * view[c * 4 + k]

  const eye = eyeOf(m)
  expect(eye[0]).toBeCloseTo(3)
  expect(eye[1]).toBeCloseTo(-4)
  expect(eye[2]).toBeCloseTo(5)
})
