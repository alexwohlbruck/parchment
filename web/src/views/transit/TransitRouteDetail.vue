<script setup lang="ts">
/**
 * Transit Route Detail View
 *
 * Dedicated route at /transit/route/:feedId/:routeId
 * Query params: ?direction=...&vehicle=...
 */
import { watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useRouteDetailStore } from '@/stores/route-detail.store'
import RouteDetailPage from '@/components/place/pages/RouteDetailPage.vue'

const route = useRoute()
const router = useRouter()
const store = useRouteDetailStore()

const feedId = route.params.feedId as string
const routeId = route.params.routeId as string

// Restore selections from query params
const initialDirection = (route.query.direction as string) || undefined
const initialVehicle = (route.query.vehicle as string) || undefined

if (initialDirection) store.setDirection(initialDirection)
if (initialVehicle) store.selectVehicle(initialVehicle)

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

    // Only update if actually different to avoid navigation loops
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
    :feedId="feedId"
    :routeId="routeId"
  />
</template>
