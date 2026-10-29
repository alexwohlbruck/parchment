import { expect, it, vi } from 'vitest'
import { LandmarkLayer } from './landmark-layer'
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
