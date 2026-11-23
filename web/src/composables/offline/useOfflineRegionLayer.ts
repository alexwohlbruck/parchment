import { onScopeDispose, type Ref } from 'vue'
import { useAreaLayer } from '@/composables/map/useAreaLayer'
import { useMapPoiClickSuppression } from '@/composables/map/useMapPoiClickSuppression'
import { whenMapReady } from '@/composables/map/whenMapReady'
import { useMapService } from '@/services/map/map.service'
import { useOfflineStore } from '@/stores/offline.store'
import {
  OFFLINE_REGIONS_FILL_LAYER_ID,
  OFFLINE_REGIONS_LINE_LAYER_ID,
  OFFLINE_REGIONS_SOURCE_ID,
} from '@/constants/layers'
import type { Bounds } from '@/types/offline.types'

const OPACITY = 0.1
const HIGHLIGHT_OPACITY = 0.28
const FIT_PADDING = 48

const boundsPolygon = ([w, s, e, n]: Bounds): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
})

/** Saved areas drawn on the map; hovering one highlights it and clicking picks it. */
export function useOfflineRegionLayer(highlighted: Ref<string | null>, onPick: (id: string) => void) {
  const offlineStore = useOfflineStore()
  const mapService = useMapService()

  useMapPoiClickSuppression()
  useAreaLayer(
    { source: OFFLINE_REGIONS_SOURCE_ID, fill: OFFLINE_REGIONS_FILL_LAYER_ID, line: OFFLINE_REGIONS_LINE_LAYER_ID },
    () => true,
    () => ({
      type: 'FeatureCollection',
      features: offlineStore.regions.map(r => ({
        type: 'Feature',
        properties: { id: r.id, opacity: r.id === highlighted.value ? HIGHLIGHT_OPACITY : OPACITY },
        geometry: boundsPolygon(r.bounds),
      })),
    }),
  )

  const regionAt = (e: { features?: { properties?: { id?: string } }[] }) => e.features?.[0]?.properties?.id ?? null

  whenMapReady(() => {
    const map = mapService.mapStrategy?.mapInstance
    if (!map) return
    const canvas = map.getCanvas()
    const onMove = (e: any) => {
      highlighted.value = regionAt(e)
      canvas.style.cursor = 'pointer'
    }
    const onLeave = () => {
      highlighted.value = null
      canvas.style.cursor = ''
    }
    const onClick = (e: any) => {
      const id = regionAt(e)
      if (id) onPick(id)
    }
    map.on('mousemove', OFFLINE_REGIONS_FILL_LAYER_ID, onMove)
    map.on('mouseleave', OFFLINE_REGIONS_FILL_LAYER_ID, onLeave)
    map.on('click', OFFLINE_REGIONS_FILL_LAYER_ID, onClick)
    onScopeDispose(() => {
      map.off('mousemove', OFFLINE_REGIONS_FILL_LAYER_ID, onMove)
      map.off('mouseleave', OFFLINE_REGIONS_FILL_LAYER_ID, onLeave)
      map.off('click', OFFLINE_REGIONS_FILL_LAYER_ID, onClick)
      canvas.style.cursor = ''
    })
  })

  /** Frame every saved area, for a first look at what's on the device. */
  function showAll() {
    const all = offlineStore.regions.map(r => r.bounds)
    if (!all.length) return
    whenMapReady(() =>
      mapService.fitBounds({
        minLng: Math.min(...all.map(b => b[0])),
        minLat: Math.min(...all.map(b => b[1])),
        maxLng: Math.max(...all.map(b => b[2])),
        maxLat: Math.max(...all.map(b => b[3])),
      }, { padding: { top: FIT_PADDING, right: FIT_PADDING, bottom: FIT_PADDING, left: FIT_PADDING } }),
    )
  }

  return { showAll }
}
