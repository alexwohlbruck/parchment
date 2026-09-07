<script setup lang="ts">
/**
 * Transit Route Detail View
 *
 * Dedicated route at /transit/route/:feedId/:routeId
 * Query params: ?direction=...&vehicle=...
 */
import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useRouteDetailStore } from '@/stores/route-detail.store'
import { useAppStore } from '@/stores/app.store'
import RouteDetailPage from '@/components/place/pages/RouteDetailPage.vue'

const route = useRoute()
const router = useRouter()
const store = useRouteDetailStore()

// Opening a route IS asking to see this panel. With the drawer left hidden,
// the camera fits the route to the full viewport — and expanding the drawer
// afterwards covers the western half of the line with no re-fit coming. The
// unhide starts the slide now, so the fit's settle logic frames the route
// against the drawer it will actually be read next to.
useAppStore().leftSheetHidden = false

// Reactive, because a bullet inside the page navigates to ANOTHER route on
// the same path — the router reuses this component, and the key below is
// what makes the page remount for the new line.
const feedId = computed(() => route.params.feedId as string)
const routeId = computed(() => route.params.routeId as string)

// Restore direction immediately (doesn't depend on data)
const initialDirection = (route.query.direction as string) || undefined
if (initialDirection) store.setDirection(initialDirection)

// Defer vehicle selection until vehicles have loaded — selectVehicle
// needs the vehicle in the store to fetch trip stop times.
const initialVehicle = (route.query.vehicle as string) || undefined
if (initialVehicle) {
  const stopWatch = watch(
    () => store.vehicles.size,
    (size) => {
      if (size > 0 && store.vehicles.has(initialVehicle)) {
        store.selectVehicle(initialVehicle)
        stopWatch()
      }
    },
  )
  // Give up after 30s to avoid leaking the watcher
  setTimeout(stopWatch, 30_000)
}

// Sync selections back to query params
watch(
  () => ({
    direction: store.activeDirection,
    vehicle: store.selectedVehicleId,
  }),
  ({ direction, vehicle }) => {
    const query: Record<string, string> = {}
    if (direction) query.direction = direction
    if (vehicle) query.vehicle = vehicle

    const current = route.query
    if (current.direction !== (query.direction || undefined) ||
        current.vehicle !== (query.vehicle || undefined)) {
      router.replace({ query })
    }
  },
  { immediate: false },
)
</script>

<template>
  <RouteDetailPage
    v-if="feedId && routeId"
    :key="`${feedId}/${routeId}`"
    :feedId="feedId"
    :routeId="routeId"
  />
</template>
