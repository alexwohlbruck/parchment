import { computed, ref, watch } from 'vue'
import { useGuidanceStore } from '@/stores/guidance.store'
import { segmentAt } from '@/lib/guidance/nav-route'
import { offersParking, parkingDestination } from '@/lib/guidance/parking'

/** Where parking would lead from the drive in progress, and whether to suggest it unasked. */
export function useParkingOffer() {
  const guidance = useGuidanceStore()

  const current = computed(() => {
    const route = guidance.route
    const puck = guidance.progress?.puck
    return route && puck ? segmentAt(route, puck.s) : null
  })
  const destination = computed(() =>
    guidance.kind === 'route' && current.value ? parkingDestination(guidance.segments, current.value.index) : null,
  )
  const key = computed(() => (destination.value ? `${destination.value.location.lat},${destination.value.location.lng}` : null))

  const dismissed = ref(false)
  watch(key, () => (dismissed.value = false))

  const offered = computed(() => {
    const segment = current.value
    const s = guidance.progress?.puck.s
    if (!segment || s == null || dismissed.value || guidance.status !== 'navigating' || !destination.value) return false
    return offersParking(guidance.segments, segment.index, segment.endDistance - s)
  })

  return { destination, offered, dismiss: () => (dismissed.value = true) }
}
