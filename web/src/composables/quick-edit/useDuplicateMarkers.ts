import { onUnmounted, watch, type Ref } from 'vue'
import { useMapService } from '@/services/map/map.service'
import { whenMapReady } from '@/composables/map/whenMapReady'
import PoiMarker from '@/components/map/markers/PoiMarker.vue'
import type { DuplicateCandidate, PresetSummary } from '@/types/quick-edit.types'

const MARKER_PREFIX = 'quick-edit-duplicate-'

/**
 * Draw nearby duplicate candidates on the map, de-emphasised so the pin being
 * placed stays the subject. Seeing where the existing ones are is what settles
 * "is mine already on the map?" — a distance in a list doesn't.
 */
export function useDuplicateMarkers(
  candidates: Ref<DuplicateCandidate[]>,
  preset: Ref<Pick<PresetSummary, 'iconName' | 'iconPack' | 'iconCategory'> | null>,
  origin: Ref<{ lat: number; lng: number }>,
  onSelect: (candidate: DuplicateCandidate) => void,
) {
  const { addVueMarker, removeMarkersByPrefix, fitBounds } = useMapService()

  function draw() {
    removeMarkersByPrefix(MARKER_PREFIX)
    const icon = preset.value
    if (!icon) return

    for (const candidate of candidates.value) {
      if (!Number.isFinite(candidate.lat) || !Number.isFinite(candidate.lng)) continue
      addVueMarker(
        `${MARKER_PREFIX}${candidate.osm}`,
        { lat: candidate.lat, lng: candidate.lng },
        PoiMarker,
        {
          iconName: icon.iconName,
          iconPack: icon.iconPack,
          category: icon.iconCategory,
          muted: true,
          onClick: () => onSelect(candidate),
        },
      )
    }
  }

  /** Frame the pin together with its candidates — a distance in the list
   *  doesn't settle "is mine already here?", seeing where they sit does. */
  function frame() {
    if (!candidates.value.length) return
    if (!Number.isFinite(origin.value.lat) || !Number.isFinite(origin.value.lng)) return
    const lats = [origin.value.lat, ...candidates.value.map((c) => c.lat)]
    const lngs = [origin.value.lng, ...candidates.value.map((c) => c.lng)]
    fitBounds(
      {
        minLat: Math.min(...lats),
        minLng: Math.min(...lngs),
        maxLat: Math.max(...lats),
        maxLng: Math.max(...lngs),
      },
      { padding: 120, maxZoom: 18 },
    )
  }

  watch([candidates, preset], () => whenMapReady(() => { draw(); frame() }), {
    immediate: true,
  })
  onUnmounted(() => removeMarkersByPrefix(MARKER_PREFIX))
}
