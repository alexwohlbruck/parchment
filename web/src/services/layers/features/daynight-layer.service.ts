import type { Layer } from '@/types/map.types'
import type { MapStrategy } from '@/services/map/providers/map.strategy'
import { renderDayNightCanvas } from '@/lib/daynight/daynight-canvas'
import { DAYNIGHT_LAYER_ID, DAYNIGHT_SOURCE_ID, MERCATOR_LATITUDE_LIMIT, NIGHT_LIGHTS_ATTRIBUTION, dayNightOpacity } from '@/lib/daynight/daynight'
import { MapEngine, MapProjection } from '@/types/map.types'

const UPDATE_INTERVAL_MS = 60_000
const CANVAS_WIDTH = 720
const CANVAS_HEIGHT = 360

const IMAGE_COORDINATES: [[number, number], [number, number], [number, number], [number, number]] = [
  [-180, MERCATOR_LATITUDE_LIMIT],
  [180, MERCATOR_LATITUDE_LIMIT],
  [180, -MERCATOR_LATITUDE_LIMIT],
  [-180, -MERCATOR_LATITUDE_LIMIT],
]

export function useDayNightLayerService() {
  let initialized = false
  let intervalId: ReturnType<typeof setInterval> | null = null
  let currentStrategy: MapStrategy | null = null
  let detach: (() => void) | null = null

  function isDayNightLayer(layer: Layer): boolean {
    return layer.configuration?.id === DAYNIGHT_LAYER_ID
  }

  function initializeDayNightLayer(mapStrategy: MapStrategy, layer: Layer) {
    if (initialized && currentStrategy === mapStrategy && mapStrategy.mapInstance.getLayer(DAYNIGHT_LAYER_ID)) return
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
          'raster-opacity': dayNightOpacity(usesGlobeLighting()),
          'raster-fade-duration': 0,
        },
        layout: {
          visibility: layer.visible ? 'visible' : 'none',
        },
      } as any)
    }

    const source = map.getSource(DAYNIGHT_SOURCE_ID) as { attribution?: string } | undefined
    if (source && mapStrategy.options.engine === MapEngine.MAPLIBRE) {
      source.attribution = NIGHT_LIGHTS_ATTRIBUTION
      map.fire('sourcedata', { dataType: 'source', sourceDataType: 'metadata', sourceId: DAYNIGHT_SOURCE_ID })
    }
    const onProjection = () => {
      if (map.getLayer(DAYNIGHT_LAYER_ID)) {
        map.setPaintProperty(DAYNIGHT_LAYER_ID, 'raster-opacity', dayNightOpacity(usesGlobeLighting()))
      }
    }
    const maplibre = mapStrategy.options.engine === MapEngine.MAPLIBRE
    if (maplibre) map.on('projectiontransition', onProjection)
    map.on('remove', cleanup)
    detach = () => {
      if (maplibre) map.off('projectiontransition', onProjection)
      map.off('remove', cleanup)
    }
    intervalId = setInterval(() => updateCanvas(map), UPDATE_INTERVAL_MS)
    initialized = true
  }

  function usesGlobeLighting() {
    return currentStrategy?.options.engine === MapEngine.MAPLIBRE
      && currentStrategy.options.projection === MapProjection.GLOBE
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
    detach?.()
    detach = null
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
