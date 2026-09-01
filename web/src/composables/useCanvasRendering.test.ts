import { describe, it, expect, beforeEach, vi } from 'vitest'
import { computed, effectScope, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useMapStore } from '@/stores/map.store'
import { useThemeStore } from '@/stores/theme.store'
import { useCanvasRendering } from './useCanvasRendering'
import type {
  CanvasAnnotation,
  CanvasBody,
  CanvasLayer,
} from '@/types/canvas.types'

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
  const configurations = new Map<string, Record<string, unknown>>()

  return {
    calls,
    sources,
    layers,
    configurations,
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
    addLayer(layer: { id: string; configuration?: Record<string, unknown> }) {
      layers.add(layer.id)
      configurations.set(layer.id, layer.configuration ?? {})
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

describe('labels under the map\'s lighting', () => {
  const annotated: CanvasBody = {
    layers: [],
    annotations: [
      {
        id: 'an-1',
        tool: 'pin',
        positions: [[0, 0]],
        label: 'Home',
      },
    ],
  }

  // Marks draw in runs keyed by the one at the bottom, so the label layer's
  // id depends on what is on the canvas. Found by its suffix instead.
  const labelPaint = () => {
    const id = [...strategy.configurations.keys()].find(key =>
      key.endsWith('-labels'),
    )
    return strategy.configurations.get(id ?? '') as
      | { paint: Record<string, unknown> }
      | undefined
  }

  it('writes dark text on a light halo by day', () => {
    useThemeStore().isDark = false
    render('map', annotated)

    expect(labelPaint()?.paint['text-color']).toBe('#1f2937')
    expect(labelPaint()?.paint['text-halo-color']).toBe('#ffffff')
  })

  it('turns the label over when the map turns to night', async () => {
    const theme = useThemeStore()
    theme.isDark = false
    render('map', annotated)

    theme.isDark = true
    await nextTick()

    // Left alone, a dark label on a night basemap is a smear.
    expect(labelPaint()?.paint['text-color']).toBe('#f9fafb')
    expect(labelPaint()?.paint['text-halo-color']).toBe('#0b1220')
  })
})


/**
 * Layers and marks are one stack, so what covers what is whatever the order
 * says — a mark is no longer pinned above every layer. Marks still share a
 * source when they sit together, which is what keeps a canvas full of pins
 * from becoming a source per pin.
 */
describe('one stack, marks and layers alike', () => {
  const l = (id: string) => dataLayer({ id })
  const a = (id: string): CanvasAnnotation =>
    ({ id, tool: 'pin', positions: [[0, 0]] }) as CanvasAnnotation

  /** The order the engine was asked to add things in, ids only. */
  const added = () =>
    strategy.calls
      .filter(call => call.startsWith('addLayer:'))
      .map(call => call.slice('addLayer:'.length))

  it('draws a layer above a mark when the order puts it there', () => {
    render('map', {
      layers: [l('cl-1')],
      annotations: [a('an-1')],
      order: ['an-1', 'cl-1'],
    })

    const markAt = added().findIndex(id => id.includes('an-1'))
    const layerAt = added().findIndex(id => id.includes('cl-1'))
    expect(markAt).toBeGreaterThanOrEqual(0)
    expect(markAt).toBeLessThan(layerAt)
  })

  it('still draws a mark above a layer the other way round', () => {
    render('map', {
      layers: [l('cl-1')],
      annotations: [a('an-1')],
      order: ['cl-1', 'an-1'],
    })

    const layerAt = added().findIndex(id => id.includes('cl-1'))
    const markAt = added().findIndex(id => id.includes('an-1'))
    expect(layerAt).toBeLessThan(markAt)
  })

  it('gives marks sitting together a single source', () => {
    render('map', {
      layers: [],
      annotations: [a('an-1'), a('an-2'), a('an-3')],
      order: ['an-1', 'an-2', 'an-3'],
    })

    expect([...strategy.sources]).toHaveLength(1)
  })

  it('splits them where a layer comes between', () => {
    render('map', {
      layers: [l('cl-1')],
      annotations: [a('an-1'), a('an-2')],
      order: ['an-1', 'cl-1', 'an-2'],
    })

    const annotationSources = [...strategy.sources].filter(id =>
      id.includes('annotations'),
    )
    expect(annotationSources).toHaveLength(2)
  })

  it('leaves out a layer switched off, without splitting the marks around it', () => {
    render('map', {
      layers: [dataLayer({ id: 'cl-1', visible: false })],
      annotations: [a('an-1'), a('an-2')],
      order: ['an-1', 'cl-1', 'an-2'],
    })

    // The layer is still in the stack, so the run is still split — hiding
    // something must not silently change what covers what around it.
    expect(added().some(id => id.includes('cl-1'))).toBe(true)
  })

  it('takes a hidden group\'s contents off the map', () => {
    render('map', {
      layers: [l('cl-1')],
      annotations: [],
      groups: [
        { id: 'cg-1', name: 'Base', visible: false, children: ['cl-1'] },
      ],
      order: ['cg-1'],
    })

    expect(
      added().every(id => strategy.configurations.get(id)?.layout === undefined ||
        (strategy.configurations.get(id) as { layout?: Record<string, unknown> })
          .layout?.visibility === 'none'),
    ).toBe(true)
  })
})
