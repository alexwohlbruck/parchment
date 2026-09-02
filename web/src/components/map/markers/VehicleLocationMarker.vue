<script setup lang="ts">
/**
 * Where a vehicle is parked, as a route can start from it — draggable, so the
 * user can correct it.
 *
 * The same mark as `TrackerMarker`, which draws the same vehicles on the
 * Lookout layer, minus the pulse: this one is a position you set rather than
 * one the vehicle is reporting right now, and a pulse would claim otherwise.
 */

import { computed } from 'vue'
import MapMarker from './MapMarker.vue'
import { getVehicleIcon } from '@/lib/travel-mode-icons'
import { MARKER_LIVE_PLATE_SIZE } from '@/lib/map-marker'
import { categoryMarkerPaint } from '@/lib/place-colors'
import { useAccentMarkerPaint } from '@/composables/useAccentMarkerPaint'
import { useThemeStore } from '@/stores/theme.store'

interface Props {
  vehicleType: string
  vehicleName?: string | null
  staleness?: 'fresh' | 'aging' | 'stale' | 'very-stale' | 'unknown'
}

const props = withDefaults(defineProps<Props>(), {
  staleness: 'fresh',
})

const themeStore = useThemeStore()
const accentPaint = useAccentMarkerPaint()

const icon = computed(() => getVehicleIcon(props.vehicleType))

const isStale = computed(
  () => props.staleness === 'stale' || props.staleness === 'very-stale',
)

const paint = computed(() =>
  isStale.value
    ? categoryMarkerPaint('default', themeStore.isDark)
    : accentPaint.value,
)
</script>

<template>
  <MapMarker
    class="cursor-grab active:cursor-grabbing"
    :paint="paint"
    :size="MARKER_LIVE_PLATE_SIZE"
    :muted="isStale"
    :title="vehicleName || vehicleType"
  >
    <component :is="icon" />
  </MapMarker>
</template>
