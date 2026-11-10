import { describe, expect, it, vi } from 'vitest'
import { eyeOf, LandmarkLayer, rememberedFills } from './landmark-layer'
import { mercator } from '@/lib/map-decks/decks'
import { groundLifts } from './landmark-ground'
import { groundGrid, LANDMARK_FLAVOR, type Landmark } from './landmarks'
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

it('hides the buildings once for a view, not once per model that lands', () => {
  vi.useFakeTimers()
  try {
    const onReplace = vi.fn()
    const layer = new LandmarkLayer({
      id: 'landmarks',
      source: 'detail',
      sourceLayer: 'landmarks',
      modelUrl: file => file,
      onReplace,
      flavor: LANDMARK_FLAVOR.light,
    }) as any
    layer.map = {}
    layer.invalidate = vi.fn()
    layer.placements = [
      { id: 'a', model: 'a', replaces: ['w1'] },
      { id: 'b', model: 'b', replaces: ['w2'] },
    ]
    layer.models.set('a', { batches: [] })
    layer.models.set('b', { batches: null, pending: null })

    layer.reportReplaced()
    expect(onReplace).not.toHaveBeenCalled()

    layer.models.get('b').batches = []
    layer.reportReplaced()
    expect(onReplace).toHaveBeenCalledTimes(1)
    expect(onReplace).toHaveBeenCalledWith({ refs: ['w1', 'w2'], featureIds: [] })
  } finally {
    vi.useRealTimers()
  }
})

it('stops waiting for a model that is slow or will not load', () => {
  vi.useFakeTimers()
  try {
    const onReplace = vi.fn()
    const layer = new LandmarkLayer({
      id: 'landmarks',
      source: 'detail',
      sourceLayer: 'landmarks',
      modelUrl: file => file,
      onReplace,
      flavor: LANDMARK_FLAVOR.light,
    }) as any
    layer.map = {}
    layer.invalidate = vi.fn()
    layer.placements = [
      { id: 'a', model: 'a', replaces: ['w1'] },
      { id: 'b', model: 'b', replaces: ['w2'] },
    ]
    layer.models.set('a', { batches: [] })
    layer.models.set('b', { batches: null, pending: null })

    layer.reportReplaced()
    vi.advanceTimersByTime(1500)
    expect(layer.invalidate).toHaveBeenCalled()
    layer.reportReplaced()
    expect(onReplace).toHaveBeenCalledWith({ refs: ['w1'], featureIds: [] })

    onReplace.mockClear()
    layer.models.get('b').failed = true
    layer.reportReplaced()
    expect(onReplace).not.toHaveBeenCalled() // same answer as before: nothing new to hide
  } finally {
    vi.useRealTimers()
  }
})

it('keeps the fills of landmarks that left the view, dropping the longest gone past the cap', () => {
  const fills = new Map(Array.from({ length: 70 }, (_, i) => [`gone${i}`, i]))
  fills.set('drawn', -1)
  const kept = rememberedFills(fills, new Set(['drawn']))
  expect(kept.size).toBe(65)
  expect(kept.has('drawn')).toBe(true)
  expect(kept.has('gone69')).toBe(true)
  expect(kept.has('gone5')).toBe(false)
  expect([...kept.keys()].at(-1)).toBe('drawn')
})

describe('placing a bridge', () => {
  const footprint = { minX: -130, maxX: 130, minZ: -8, maxZ: 8 }
  const base = {
    id: 'bridge', name: 'Bridge', model: 'bridge.glb', lng: -117.1545, lat: 32.73142, bearing: 0, scale: 1, elevation: 0, minzoom: 15,
    detail: null, entrances: [], replaces: [], attribution: null, bridge: true,
  } satisfies Landmark
  const anchor = mercator([base.lng, base.lat])
  /** True metres: a canyon floor 41 m up under the anchor, rising 0.2 m a metre either side. */
  const ground = ([x]: number[]) => 41 + Math.abs(x - anchor[0]) * 40075016.686 * Math.cos((base.lat * Math.PI) / 180) * 0.2

  function layerAt(exaggeration: number) {
    const layer = new LandmarkLayer({
      id: 'landmarks', source: 'detail', sourceLayer: 'landmarks', modelUrl: file => file, onReplace: vi.fn(), flavor: LANDMARK_FLAVOR.light,
    }) as any
    layer.map = { getTerrain: () => ({ exaggeration }) }
    layer.models.set(base.model, { footprint, contacts: [] })
    layer.bareGround = () => ({ ground: { at: ground } })
    const sample = (point: [number, number]) => ground(mercator(point)) * exaggeration
    const place = (landmark: Landmark) => {
      const steps = layer.liftDeck(landmark)
      while (!steps.next().done);
      return layer.place(landmark, sample, false)
    }
    return { place, heights: groundGrid(base, footprint).map(sample) }
  }

  it('is draped as any landmark with the terrain at life size', () => {
    const { place } = layerAt(1)
    const { bridge: _, ...asBridge } = place(base)
    const { bridge: __, ...asOther } = place({ ...base, bridge: false })
    expect(asBridge.deck).toBeNull()
    expect(asBridge).toEqual(asOther)
  })

  it('leaves any other landmark as it was', () => {
    const { place, heights } = layerAt(1.2)
    const tower = place({ ...base, id: 'tower', bridge: false })
    const today = groundLifts(heights, 1.2, { follows: false }, 1)
    expect(tower.deck).toBeNull()
    expect(tower.ground).toEqual(today.lifts)
    expect(tower.groundMean).toBe(today.mean)
  })

  it('is draped on the terrain as it truly is, and lifted by its deck ground', () => {
    const { place, heights } = layerAt(1.2)
    const bridge = place(base)
    const truly = groundLifts(heights.map(h => h / 1.2), 1, { follows: false }, 1)
    expect(bridge.ground).toEqual(truly.lifts)
    expect(bridge.groundMean).toBe(truly.mean)
    expect(bridge.deck).toMatchObject({ lowest: truly.lowest })
    expect(bridge.deck.strength).toBeCloseTo(0.2, 12)
    expect(bridge.deck.ground.cols).toBe(131)
    // Set on the same exaggerated ground as any landmark.
    expect(bridge.placed).toEqual(place({ ...base, bridge: false }).placed)
  })
})
