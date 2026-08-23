import { describe, it, expect, beforeEach, vi } from 'vitest'
import { computed, effectScope } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useMapStore } from '@/stores/map.store'
import { useCanvasRendering } from './useCanvasRendering'
import type { CanvasBody, CanvasLayer } from '@/types/canvas.types'

/**
 * Two renderers are routinely alive at once — the main map draws the canvases
 * you switched on, the editor draws the working copy of the one you opened —
 * so the invariants worth pinning down are about them not treading on each
 * other, and about the order operations reach the engine.
 *
 * The engine refuses to drop a source a layer is still using, so a render
 * pass that rebuilds a source has to take its layers off first. Getting that
 * backwards is silent in types and loud at runtime.
 */

vi.mock('@/composables/useFriendLocationFeatures', () => ({
  useFriendLocationFeatures: () => ({
    peopleFeatures: () => ({ type: 'FeatureCollection', features: [] }),
    displayName: (handle: string) => handle,
  }),
}))

/** Records what the map was asked to do, in order. */
function fakeStrategy() {
  const calls: string[] = []
  const sources = new Set<string>()
  const layers = new Set<string>()

  return {
    calls,
    sources,
    layers,
    mapInstance: { getSource: () => undefined, hasImage: () => true },
    addSource(id: string) {
      // Mirrors the engine: adding over a live source is an error.
      if (sources.has(id)) throw new Error(`source ${id} already exists`)
      sources.add(id)
      calls.push(`addSource:${id}`)
    },
    removeSource(id: string) {
      for (const layerId of layers) {
        if (layerId.startsWith(id.replace(/-source$/, ''))) {
          throw new Error(`source ${id} still in use by ${layerId}`)
        }
      }
      sources.delete(id)
      calls.push(`removeSource:${id}`)
    },
    addLayer(layer: { id: string }) {
      layers.add(layer.id)
      calls.push(`addLayer:${layer.id}`)
    },
    removeLayer(id: string) {
      layers.delete(id)
      calls.push(`removeLayer:${id}`)
    },
    setSourceData(id: string, _data: unknown) {
      // Mirrors the engine: there has to be a live source to hand data to.
      if (!sources.has(id)) throw new Error(`source ${id} does not exist`)
      calls.push(`setSourceData:${id}`)
    },
    toggleLayerVisibility() {},
    fitBounds() {},
  }
}

function dataLayer(overrides: Partial<CanvasLayer> = {}): CanvasLayer {
  return {
    id: 'cl-1',
    kind: 'data',
    name: 'Sites',
    visible: true,
    render: 'points',
    data: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [1, 2] },
          properties: {},
        },
      ],
    },
    ...overrides,
  } as CanvasLayer
}

/** A layer whose source spec can change in ways `setData` cannot express. */
function styleLayer(tiles: string): CanvasLayer {
  return {
    id: 'cl-2',
    kind: 'style',
    name: 'Tiles',
    visible: true,
    configuration: {
      id: 'cl-2',
      type: 'raster',
      source: { id: 'src', type: 'raster', tiles: [tiles] },
    },
  } as unknown as CanvasLayer
}

let strategy: ReturnType<typeof fakeStrategy>

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  strategy = fakeStrategy()
  useMapStore().setMapStrategy(strategy as never)
})

/** Render a canvas body under a given instance key, inside its own scope. */
function render(key: string, body: CanvasBody) {
  const scope = effectScope()
  const api = scope.run(() =>
    useCanvasRendering(
      computed(() => [{ id: 'canvas-1', body }]),
      { key },
    ),
  )!
  return { ...api, dispose: () => scope.stop() }
}

describe('useCanvasRendering', () => {
  it('draws a data layer as its preset layers over one source', () => {
    render('map', { layers: [dataLayer()] })

    expect([...strategy.sources]).toHaveLength(1)
    expect([...strategy.layers]).toEqual(['canvas-map-canvas-1-cl-1-points'])
  })

  it('keeps two live renderers off each other’s ids', () => {
    const body = { layers: [dataLayer()] }

    render('map', body)
    // The editor opening over a canvas already drawn on the map must not
    // collide — this threw "source already exists" before ids carried the key.
    expect(() => render('canvas-editor', body)).not.toThrow()

    expect([...strategy.sources].sort()).toEqual([
      'canvas-canvas-editor-canvas-1-cl-1-source',
      'canvas-map-canvas-1-cl-1-source',
    ])
  })

  it('takes layers off before rebuilding the source they draw from', () => {
    const body = { layers: [styleLayer('https://a/{z}/{x}/{y}.png')] }
    const instance = render('map', body)

    strategy.calls.length = 0
    body.layers = [styleLayer('https://b/{z}/{x}/{y}.png')]
    instance.render()

    const removeLayer = strategy.calls.indexOf(
      'removeLayer:canvas-map-canvas-1-cl-2',
    )
    const removeSource = strategy.calls.indexOf(
      'removeSource:canvas-map-canvas-1-cl-2-source',
    )
    expect(removeLayer).toBeGreaterThanOrEqual(0)
    expect(removeSource).toBeGreaterThan(removeLayer)
  })

  it('hands changed GeoJSON to the live source instead of rebuilding it', () => {
    const body = { layers: [dataLayer()] }
    const instance = render('map', body)

    strategy.calls.length = 0
    body.layers = [
      dataLayer({
        data: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [9, 9] },
              properties: {},
            },
          ],
        },
      } as never),
    ]
    instance.render()

    // Rebuilding would mean dropping every layer drawn from the source and
    // adding them back — the thing that made drawing lag.
    expect(strategy.calls).toEqual([
      'setSourceData:canvas-map-canvas-1-cl-1-source',
    ])
  })

  it('leaves an unchanged canvas entirely alone', () => {
    const body = { layers: [dataLayer()] }
    const instance = render('map', body)

    strategy.calls.length = 0
    instance.render()

    expect(strategy.calls).toEqual([])
  })

  it('leaves the source alone when only the styling changed', () => {
    const body = { layers: [dataLayer()] }
    const instance = render('map', body)

    strategy.calls.length = 0
    body.layers = [dataLayer({ style: { color: '#ff0000' } } as never)]
    instance.render()

    // No tile or feature refetch for a colour change.
    expect(strategy.calls.filter(c => c.startsWith('addSource'))).toEqual([])
    expect(strategy.calls.filter(c => c.startsWith('removeSource'))).toEqual([])
  })

  it('drops a layer and its source when it is removed from the canvas', () => {
    const body = { layers: [dataLayer()] }
    const instance = render('map', body)

    body.layers = []
    instance.render()

    expect([...strategy.layers]).toEqual([])
    expect([...strategy.sources]).toEqual([])
  })

  it('takes everything down again when the renderer goes away', () => {
    const instance = render('map', { layers: [dataLayer()] })

    instance.dispose()

    expect([...strategy.layers]).toEqual([])
    expect([...strategy.sources]).toEqual([])
  })

  it('skips a library layer that no longer exists rather than drawing nothing', () => {
    render('map', {
      layers: [{ id: 'cl-x', kind: 'library', layerId: 'gone', visible: true }],
    })

    expect([...strategy.layers]).toEqual([])
  })
})
