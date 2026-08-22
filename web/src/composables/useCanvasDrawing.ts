/**
 * Drawing geometry straight onto a canvas.
 *
 * Clicking the map is normally "open whatever is here", so drawing takes the
 * click event over entirely while it's armed — the same mechanism the measure
 * tool uses — and hands it back on finish or cancel. Nothing is written to the
 * canvas until the drawing is finished, so escaping out of it leaves no trace.
 *
 * Each mode collects the same thing (a list of clicked positions) and closes
 * it differently: points become a feature each, a line becomes one LineString,
 * a shape becomes a closed ring. The in-progress geometry is drawn on the map
 * from a scratch source so you can see what you're making.
 */

import { computed, onScopeDispose, ref } from 'vue'
import type { Feature, FeatureCollection, Position } from 'geojson'
import { mapEventBus } from '@/lib/eventBus'
import { useMapStore } from '@/stores/map.store'
import type { LngLat, MapEvents } from '@/types/map.types'
import type { CanvasDataRender } from '@/types/canvas.types'

const SOURCE_ID = 'canvas-draw-scratch'
const FILL_LAYER_ID = 'canvas-draw-fill'
const LINE_LAYER_ID = 'canvas-draw-line'
const POINT_LAYER_ID = 'canvas-draw-points'

/** Minimum vertices before a mode can be finished. */
const MINIMUM: Record<CanvasDataRender, number> = {
  points: 1,
  lines: 2,
  shapes: 3,
  heatmap: 1,
}

export function useCanvasDrawing() {
  const mapStore = useMapStore()

  const mode = ref<CanvasDataRender | null>(null)
  const positions = ref<Position[]>([])

  const isDrawing = computed(() => mode.value !== null)
  const canFinish = computed(
    () => !!mode.value && positions.value.length >= MINIMUM[mode.value],
  )
  const canUndo = computed(() => positions.value.length > 0)

  /** The geometry so far, as something the map can draw. */
  function scratchCollection(): FeatureCollection {
    const coordinates = positions.value
    const features: Feature[] = coordinates.map(position => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: position },
      properties: {},
    }))

    if (mode.value === 'lines' && coordinates.length >= 2) {
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates },
        properties: {},
      })
    }
    if (mode.value === 'shapes' && coordinates.length >= 3) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[...coordinates, coordinates[0]]] },
        properties: {},
      })
    }
    return { type: 'FeatureCollection', features }
  }

  function ensureScratchLayers() {
    const strategy = mapStore.getMapStrategy()
    if (!strategy) return
    const map = strategy.mapInstance as {
      getSource: (id: string) => { setData?: (data: unknown) => void } | undefined
    }

    if (map.getSource(SOURCE_ID)) {
      map.getSource(SOURCE_ID)?.setData?.(scratchCollection())
      return
    }

    strategy.addSource(SOURCE_ID, {
      type: 'geojson',
      data: scratchCollection(),
    })
    const base = {
      id: '',
      name: 'Canvas drawing',
      showInLayerSelector: false,
      visible: true,
      order: 0,
      groupId: null,
    }
    strategy.addLayer(
      {
        ...base,
        id: FILL_LAYER_ID,
        configuration: {
          id: FILL_LAYER_ID,
          type: 'fill',
          source: SOURCE_ID,
          filter: ['==', ['geometry-type'], 'Polygon'],
          paint: { 'fill-color': '#2563eb', 'fill-opacity': 0.2 },
        },
      } as never,
      true,
    )
    strategy.addLayer(
      {
        ...base,
        id: LINE_LAYER_ID,
        configuration: {
          id: LINE_LAYER_ID,
          type: 'line',
          source: SOURCE_ID,
          filter: ['!=', ['geometry-type'], 'Point'],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#2563eb', 'line-width': 3 },
        },
      } as never,
      true,
    )
    strategy.addLayer(
      {
        ...base,
        id: POINT_LAYER_ID,
        configuration: {
          id: POINT_LAYER_ID,
          type: 'circle',
          source: SOURCE_ID,
          filter: ['==', ['geometry-type'], 'Point'],
          paint: {
            'circle-color': '#ffffff',
            'circle-radius': 5,
            'circle-stroke-width': 2.5,
            'circle-stroke-color': '#2563eb',
          },
        },
      } as never,
      true,
    )
  }

  function clearScratchLayers() {
    const strategy = mapStore.getMapStrategy()
    if (!strategy) return
    // Layers before the source they draw from.
    ;[POINT_LAYER_ID, LINE_LAYER_ID, FILL_LAYER_ID].forEach(id =>
      strategy.removeLayer(id),
    )
    strategy.removeSource(SOURCE_ID)
  }

  function onMapClick(event: MapEvents['click']) {
    const lngLat = event.lngLat as LngLat
    positions.value = [...positions.value, [lngLat.lng, lngLat.lat]]
    ensureScratchLayers()
  }

  function start(next: CanvasDataRender) {
    if (mode.value) cancel()
    mode.value = next
    positions.value = []
    mapEventBus.setOverride('click', onMapClick)
    ensureScratchLayers()
  }

  function undo() {
    positions.value = positions.value.slice(0, -1)
    ensureScratchLayers()
  }

  function stop() {
    mapEventBus.removeOverride('click', onMapClick)
    clearScratchLayers()
    mode.value = null
    positions.value = []
  }

  function cancel() {
    stop()
  }

  /**
   * Close the drawing into features. Returns null when there isn't enough to
   * make anything, so the caller can leave the canvas untouched.
   */
  function finish(): { render: CanvasDataRender; data: FeatureCollection } | null {
    if (!mode.value || !canFinish.value) {
      stop()
      return null
    }
    const render = mode.value
    const coordinates = positions.value
    let features: Feature[]

    if (render === 'lines') {
      features = [
        {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates },
          properties: {},
        },
      ]
    } else if (render === 'shapes') {
      features = [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            // GeoJSON rings must close on themselves; the user shouldn't have
            // to click the first vertex again to say so.
            coordinates: [[...coordinates, coordinates[0]]],
          },
          properties: {},
        },
      ]
    } else {
      features = coordinates.map(position => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: position },
        properties: {},
      }))
    }

    stop()
    return { render, data: { type: 'FeatureCollection', features } }
  }

  onScopeDispose(() => {
    if (mode.value) stop()
  })

  return {
    mode,
    isDrawing,
    canFinish,
    canUndo,
    vertexCount: computed(() => positions.value.length),
    start,
    undo,
    finish,
    cancel,
  }
}
