import type { Layer } from '@/types/map.types'
import { MapStrategy } from '@/components/map/map-providers/map.strategy'
import { renderDayNightCanvas } from '@/lib/daynight.utils'

const DAYNIGHT_SOURCE_ID = 'daynight'
const DAYNIGHT_LAYER_ID = 'daynight-overlay'
const UPDATE_INTERVAL_MS = 60_000
const CANVAS_WIDTH = 720
const CANVAS_HEIGHT = 360

const IMAGE_COORDINATES: [[number, number], [number, number], [number, number], [number, number]] = [
  [-180, 85],
  [180, 85],
  [180, -85],
  [-180, -85],
]

export function useDayNightLayerService() {
  let initialized = false
  let intervalId: ReturnType<typeof setInterval> | null = null
  let currentStrategy: MapStrategy | null = null

  function isDayNightLayer(layer: Layer): boolean {
    return layer.configuration?.id === DAYNIGHT_LAYER_ID
  }

  function initializeDayNightLayer(mapStrategy: MapStrategy, layer: Layer) {
    if (initialized && currentStrategy === mapStrategy) return
    cleanup()
    currentStrategy = mapStrategy
    const map = mapStrategy.mapInstance

    const canvas = renderDayNightCanvas(CANVAS_WIDTH, CANVAS_HEIGHT)
    const dataUrl = canvas.toDataURL('image/png')

    if (!map.getSource(DAYNIGHT_SOURCE_ID)) {
      map.addSource(DAYNIGHT_SOURCE_ID, {
        type: 'image',
        url: dataUrl,
        coordinates: IMAGE_COORDINATES,
      } as any)
    }

    if (!map.getLayer(DAYNIGHT_LAYER_ID)) {
      map.addLayer({
        id: DAYNIGHT_LAYER_ID,
        type: 'raster',
        source: DAYNIGHT_SOURCE_ID,
        paint: {
          'raster-opacity': [
            'interpolate', ['linear'], ['zoom'],
            0, 1,
            6, 0.7,
            8, 0.2,
            9, 0,
          ] as any,
          'raster-fade-duration': 0,
        },
        layout: {
          visibility: layer.visible ? 'visible' : 'none',
        },
      } as any)
    }

    intervalId = setInterval(() => updateCanvas(map), UPDATE_INTERVAL_MS)
    initialized = true
  }

  function updateCanvas(map: any) {
    const source = map.getSource(DAYNIGHT_SOURCE_ID)
    if (!source) return
    const canvas = renderDayNightCanvas(CANVAS_WIDTH, CANVAS_HEIGHT)
    source.updateImage({
      url: canvas.toDataURL('image/png'),
      coordinates: IMAGE_COORDINATES,
    })
  }

  function cleanup() {
    if (intervalId) {
      clearInterval(intervalId)
      intervalId = null
    }
    initialized = false
    currentStrategy = null
  }

  return {
    isDayNightLayer,
    initializeDayNightLayer,
    cleanup,
  }
}
