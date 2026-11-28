import { computed, shallowRef, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useDirectionsStore } from '@/stores/directions.store'
import { useLatestRequest, SUPERSEDED } from '@/composables/useLatestRequest'
import { fetchArrivalPoints } from '@/services/place/arrival-points.service'
import { arrivalParent, arrivalPointsQuery } from '@/lib/directions/arrival-points'
import type { Place } from '@/types/place.types'

/** The precise places to arrive at inside the trip's destination, and which one is chosen. */
export function useArrivalPoints() {
  const store = useDirectionsStore()
  const { waypoints, selectedMode } = storeToRefs(store)
  const loading = useLatestRequest('failed to load arrival points')

  const parent = shallowRef<Partial<Place> | null>(null)
  const points = shallowRef<Place[]>([])

  const destinationIndex = computed(() => {
    const index = waypoints.value.map(wp => !!wp.lngLat).lastIndexOf(true)
    return index > 0 ? index : -1
  })
  const destination = computed(() => waypoints.value[destinationIndex.value]?.place ?? null)

  watch(
    destination,
    place => {
      const next = arrivalParent(place, parent.value, points.value)
      if (next?.id !== parent.value?.id) points.value = []
      parent.value = next
    },
    { immediate: true },
  )

  const query = computed(() => arrivalPointsQuery(parent.value, selectedMode.value))

  watch(
    () => JSON.stringify(query.value),
    async () => {
      if (!query.value) {
        loading.abort()
        points.value = []
        return
      }
      const found = await loading.run(signal => fetchArrivalPoints(query.value!, signal))
      if (found !== SUPERSEDED) points.value = found ?? []
    },
    { immediate: true },
  )

  const selectedId = computed(() =>
    destination.value?.id === parent.value?.id ? null : destination.value?.id ?? null)

  function arriveAt(place: Partial<Place> | null) {
    const center = place?.geometry?.value?.center
    const index = destinationIndex.value
    if (!place || !center || index < 0) return
    store.setWaypoint(index, {
      ...waypoints.value[index],
      place: place as Place,
      lngLat: { lat: center.lat, lng: center.lng },
    })
  }

  /** Choosing the point already chosen goes back to the place as a whole. */
  function toggle(point: Place) {
    arriveAt(point.id === selectedId.value ? parent.value : point)
  }

  return { points, selectedId, toggle }
}
