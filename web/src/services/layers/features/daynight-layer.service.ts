import type { Layer } from '@/types/map.types'
import { MapStrategy } from '@/components/map/map-providers/map.strategy'
import { renderDayNightImage } from '@/lib/daynight.utils'

const DAYNIGHT_LAYER_ID = 'daynight-overlay'
const DAYNIGHT_SOURCE_ID = 'daynight'
const UPDATE_INTERVAL_MS = 60_000
const IMAGE_WIDTH = 1440
const IMAGE_HEIGHT = 720

const WORLD_BOUNDS: [[number, number], [number, number], [number, number], [number, number]] = [
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

  function updateImage(map: any) {
    const source = map.getSource(DAYNIGHT_SOURCE_ID)
    if (!source) return
    const dataUrl = renderDayNightImage(IMAGE_WIDTH, IMAGE_HEIGHT)
    source.updateImage({ url: dataUrl })
  }

  function initializeDayNightLayer(mapStrategy: MapStrategy, layer: Layer) {
    if (initialized && currentStrategy === mapStrategy) return
    cleanup()
    currentStrategy = mapStrategy
    const map = mapStrategy.mapInstance

    const dataUrl = renderDayNightImage(IMAGE_WIDTH, IMAGE_HEIGHT)

    map.addSource(DAYNIGHT_SOURCE_ID, {
      type: 'image',
      url: dataUrl,
      coordinates: WORLD_BOUNDS,
    })

    map.addLayer({
      id: DAYNIGHT_LAYER_ID,
      type: 'raster',
      source: DAYNIGHT_SOURCE_ID,
      paint: {
        'raster-opacity': [
          'interpolate', ['linear'], ['zoom'],
          0, 0.85,
          5, 0.7,
          7, 0.3,
          8, 0,
        ],
        'raster-fade-duration': 0,
      },
      layout: {
        visibility: layer.visible ? 'visible' : 'none',
      },
    })

    intervalId = setInterval(() => updateImage(map), UPDATE_INTERVAL_MS)
    initialized = true
  }

  function cleanup() {
    if (intervalId) {
      clearInterval(intervalId)
      intervalId = null
    }
    if (currentStrategy?.mapInstance) {
      const map = currentStrategy.mapInstance
      if (map.getLayer(DAYNIGHT_LAYER_ID)) map.removeLayer(DAYNIGHT_LAYER_ID)
      if (map.getSource(DAYNIGHT_SOURCE_ID)) map.removeSource(DAYNIGHT_SOURCE_ID)
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
