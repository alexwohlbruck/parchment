import { computed, shallowRef, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useDirectionsStore } from '@/stores/directions.store'
import { useLatestRequest, SUPERSEDED } from '@/composables/useLatestRequest'
import { fetchArrivalPoints } from '@/services/place/arrival-points.service'
import { arrivalTarget } from '@/lib/directions/arrival-points'
import type { Place } from '@/types/place.types'

/**
 * The large place the trip ends in, and the precise places to arrive at there.
 * Covers destinations that never went through search: the place page's
 * Directions button, a map right-click, a shared link, a terminal already picked.
 */
export function useDestinationArrivals() {
  const store = useDirectionsStore()
  const { waypoints, selectedMode } = storeToRefs(store)
  const loading = useLatestRequest('failed to load arrival points')

  const parent = shallowRef<Place | null>(null)
  const points = shallowRef<Place[]>([])

  const index = computed(() => {
    const last = waypoints.value.map(wp => !!wp.lngLat).lastIndexOf(true)
    return last > 0 ? last : -1
  })
  const target = computed(() => arrivalTarget(waypoints.value[index.value]))

  watch(
    () => JSON.stringify([target.value, selectedMode.value]),
    async () => {
      const ask = target.value
      if (!ask) {
        loading.abort()
        parent.value = null
        points.value = []
        return
      }
      const found = await loading.run(signal => fetchArrivalPoints(ask, selectedMode.value, signal))
      if (found === SUPERSEDED) return
      parent.value = found?.parent ?? null
      points.value = found?.places ?? []
    },
    { immediate: true },
  )

  const selectedId = computed(() => waypoints.value[index.value]?.place?.id ?? null)

  return { index, parent, points, selectedId }
}
