import { computed, onUnmounted, watch } from 'vue'
import { useMapService } from '@/services/map/map.service'
import { useThemeStore } from '@/stores/theme.store'
import { mapEventBus } from '@/lib/event-bus'
import { themeHslToHex, getThemeColorHex } from '@/lib/utils'
import { AREA_FILL_LAYER_SPEC, AREA_LINE_LAYER_SPEC } from '@/constants/layers'

export interface AreaLayerIds {
  source: string
  fill: string
  line: string
}

/**
 * Polygons painted in the theme colour while `active` holds. Each feature
 * shades itself through an `opacity` property. Layers are restored after a
 * basemap swap, which drops them.
 */
export function useAreaLayer(
  ids: AreaLayerIds,
  active: () => boolean,
  data: () => GeoJSON.FeatureCollection,
) {
  const mapService = useMapService()
  const themeStore = useThemeStore()

  const color = computed(
    () => themeHslToHex(themeStore.themePrimary) ?? getThemeColorHex('text-primary'),
  )

  function mapInstance() {
    const map = mapService.mapStrategy?.mapInstance
    return map && map.getStyle() ? map : null
  }

  function add() {
    const map = mapInstance()
    if (!map || map.getSource(ids.source)) return
    map.addSource(ids.source, { type: 'geojson', data: data() })
    map.addLayer({
      id: ids.fill,
      ...AREA_FILL_LAYER_SPEC,
      source: ids.source,
      paint: { ...AREA_FILL_LAYER_SPEC.paint, 'fill-color': color.value },
    })
    map.addLayer({
      id: ids.line,
      ...AREA_LINE_LAYER_SPEC,
      source: ids.source,
      paint: { ...AREA_LINE_LAYER_SPEC.paint, 'line-color': color.value },
    })
  }

  function remove() {
    const map = mapInstance()
    if (!map) return
    if (map.getLayer(ids.line)) map.removeLayer(ids.line)
    if (map.getLayer(ids.fill)) map.removeLayer(ids.fill)
    if (map.getSource(ids.source)) map.removeSource(ids.source)
  }

  function update() {
    const source = mapInstance()?.getSource(ids.source) as
      | { setData: (data: unknown) => void }
      | undefined
    source?.setData(data())
  }

  function recolor() {
    const map = mapInstance()
    if (!map) return
    if (map.getLayer(ids.fill)) map.setPaintProperty(ids.fill, 'fill-color', color.value)
    if (map.getLayer(ids.line)) map.setPaintProperty(ids.line, 'line-color', color.value)
  }

  function onStyleLoad() {
    if (!active()) return
    add()
    update()
  }

  watch(active, on => (on ? (add(), update()) : remove()), { immediate: true })
  watch(data, () => {
    if (active()) update()
  })
  watch(color, () => {
    if (active()) recolor()
  })

  mapEventBus.on('style.load', onStyleLoad)
  onUnmounted(() => {
    mapEventBus.off('style.load', onStyleLoad)
    remove()
  })

  return { color }
}
